//! Local Sign in with ChatGPT. OAuth credentials never enter the webview.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use keyring::{Entry, Error as KeyringError};
use once_cell::sync::Lazy;
use ring::signature::{RsaPublicKeyComponents, RSA_PKCS1_2048_8192_SHA256};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex as StdMutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener, sync::{Mutex, watch}};

const RESOURCE: &str = "https://api.openai.com/v1";
const AUTH_URL: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN_URL: &str = "https://auth.openai.com/api/accounts/oauth/token";
const JWKS_URL: &str = "https://auth.openai.com/.well-known/jwks.json";
const SCOPES: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
static TOKEN_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
static ACTIVE: Lazy<StdMutex<HashMap<String, watch::Sender<bool>>>> =
    Lazy::new(|| StdMutex::new(HashMap::new()));

struct ActiveRequest(String);
impl Drop for ActiveRequest {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.lock() { active.remove(&self.0); }
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Profile {
    client_id: String,
    subject: String,
    email: Option<String>,
    id_token: String,
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    scope: String,
}

#[derive(Clone, Serialize)]
pub struct PlanStatus {
    connected: bool,
    email: Option<String>,
    plan_enabled: bool,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn entry(app: &AppHandle, account: &str) -> Result<Entry, String> {
    Entry::new(&format!("{}.chatgpt-plan", app.config().identifier), account)
        .map_err(|_| "Credential store unavailable".to_string())
}

fn read_secret(app: &AppHandle, account: &str) -> Result<Option<String>, String> {
    match entry(app, account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(_) => Err("Could not read ChatGPT credentials".into()),
    }
}

fn save_secret(app: &AppHandle, account: &str, value: &str) -> Result<(), String> {
    entry(app, account)?.set_password(value)
        .map_err(|_| "Could not save ChatGPT credentials".to_string())
}

fn load_profile(app: &AppHandle) -> Result<Option<Profile>, String> {
    let Some(raw) = read_secret(app, "active-profile")? else { return Ok(None); };
    let mut profile: Profile = serde_json::from_str(&raw)
        .map_err(|_| "Invalid saved ChatGPT profile")?;
    profile.id_token = read_secret(app, "id-token")?.ok_or("Missing ChatGPT identity credential")?;
    profile.access_token = read_secret(app, "access-token")?.ok_or("Missing ChatGPT access credential")?;
    profile.refresh_token = read_secret(app, "refresh-token")?.ok_or("Missing ChatGPT refresh credential")?;
    Ok(Some(profile))
}

fn save_profile(app: &AppHandle, profile: &Profile) -> Result<(), String> {
    save_secret(app, "id-token", &profile.id_token)?;
    save_secret(app, "access-token", &profile.access_token)?;
    save_secret(app, "refresh-token", &profile.refresh_token)?;
    let mut metadata = profile.clone();
    metadata.id_token.clear();
    metadata.access_token.clear();
    metadata.refresh_token.clear();
    let raw = serde_json::to_string(&metadata).map_err(|_| "Could not serialize ChatGPT profile")?;
    save_secret(app, "active-profile", &raw)
}

fn host_id(app: &AppHandle) -> Result<String, String> {
    if let Some(id) = read_secret(app, "host-id")? { return Ok(id); }
    let id = format!("urn:uuid:{}", uuid::Uuid::new_v4());
    save_secret(app, "host-id", &id)?;
    Ok(id)
}

fn status(profile: Option<&Profile>) -> PlanStatus {
    PlanStatus {
        connected: profile.is_some(),
        email: profile.and_then(|p| p.email.clone()),
        plan_enabled: profile.is_some_and(|p| p.scope.split_whitespace()
            .any(|scope| scope == "chatgpt.tokens.use.direct")),
    }
}

fn random_value() -> String {
    URL_SAFE_NO_PAD.encode(uuid::Uuid::new_v4().as_bytes())
        + &URL_SAFE_NO_PAD.encode(uuid::Uuid::new_v4().as_bytes())
}

fn verify_id_token(token: &str, expected_client: &str, expected_nonce: &str, jwks: &Value)
    -> Result<(String, Option<String>), String>
{
    let parts: Vec<_> = token.split('.').collect();
    if parts.len() != 3 { return Err("Malformed ChatGPT identity token".into()); }
    let header: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[0])
        .map_err(|_| "Invalid identity token header")?).map_err(|_| "Invalid identity token header")?;
    if header["alg"] != "RS256" { return Err("Unsupported ChatGPT identity signature".into()); }
    let kid = header["kid"].as_str().ok_or("Missing identity signing key")?;
    let key = jwks["keys"].as_array().and_then(|keys| keys.iter()
        .find(|key| key["kid"] == kid && key["kty"] == "RSA"))
        .ok_or("ChatGPT identity signing key not found")?;
    let n = URL_SAFE_NO_PAD.decode(key["n"].as_str().ok_or("Invalid signing key")?)
        .map_err(|_| "Invalid signing key")?;
    let e = URL_SAFE_NO_PAD.decode(key["e"].as_str().ok_or("Invalid signing key")?)
        .map_err(|_| "Invalid signing key")?;
    let signature = URL_SAFE_NO_PAD.decode(parts[2]).map_err(|_| "Invalid identity signature")?;
    RsaPublicKeyComponents { n: &n, e: &e }
        .verify(&RSA_PKCS1_2048_8192_SHA256, format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature)
        .map_err(|_| "ChatGPT identity signature verification failed")?;
    let claims: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1])
        .map_err(|_| "Invalid identity claims")?).map_err(|_| "Invalid identity claims")?;
    if claims["iss"] != "https://auth.openai.com" ||
        !match &claims["aud"] {
            Value::String(aud) => aud == expected_client,
            Value::Array(aud) => aud.iter().any(|item| item == expected_client),
            _ => false,
        } ||
        claims["nonce"] != expected_nonce ||
        claims["exp"].as_u64().unwrap_or(0) <= now()
    { return Err("ChatGPT identity claims did not match this sign-in".into()); }
    let subject = claims["sub"].as_str().filter(|s| !s.is_empty())
        .ok_or("ChatGPT identity has no subject")?.to_string();
    Ok((subject, claims["email"].as_str().map(str::to_string)))
}

fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url]).spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(url).spawn();
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(url).spawn();
    result.map(|_| ()).map_err(|_| "Could not open the system browser".into())
}

async fn fresh_profile(app: &AppHandle) -> Result<Profile, String> {
    let _guard = TOKEN_LOCK.lock().await;
    let mut profile = load_profile(app)?.ok_or("Connect a ChatGPT account in Settings first")?;
    if profile.expires_at > now() + 60 { return Ok(profile); }
    let response = reqwest::Client::new().post(TOKEN_URL).form(&[
        ("grant_type", "refresh_token"),
        ("client_id", profile.client_id.as_str()),
        ("refresh_token", profile.refresh_token.as_str()),
        ("resource", RESOURCE),
    ]).send().await.map_err(|_| "Could not refresh ChatGPT access")?;
    if !response.status().is_success() {
        return Err("ChatGPT connection expired. Reconnect in Settings".into());
    }
    let body: Value = response.json().await.map_err(|_| "Invalid ChatGPT refresh response")?;
    profile.access_token = body["access_token"].as_str().ok_or("No ChatGPT access token")?.into();
    if let Some(refresh) = body["refresh_token"].as_str() { profile.refresh_token = refresh.into(); }
    profile.expires_at = now() + body["expires_in"].as_u64().unwrap_or(3600);
    if let Some(scope) = body["scope"].as_str() { profile.scope = scope.into(); }
    save_profile(app, &profile)?;
    Ok(profile)
}

#[tauri::command]
pub fn chatgpt_plan_status(app: AppHandle) -> Result<PlanStatus, String> {
    Ok(status(load_profile(&app)?.as_ref()))
}

#[tauri::command]
pub fn chatgpt_plan_sign_out(app: AppHandle) -> Result<(), String> {
    if let Ok(active) = ACTIVE.lock() {
        for sender in active.values() { let _ = sender.send(true); }
    }
    for account in ["active-profile", "id-token", "access-token", "refresh-token"] {
        match entry(&app, account)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => {},
            Err(_) => return Err("Could not clear local ChatGPT credentials".into()),
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn chatgpt_plan_sign_in(app: AppHandle) -> Result<PlanStatus, String> {
    let listener = TcpListener::bind("127.0.0.1:0").await
        .map_err(|_| "Could not start local sign-in callback")?;
    let port = listener.local_addr().map_err(|_| "Could not read callback address")?.port();
    let redirect = format!("http://127.0.0.1:{port}/auth/callback");
    let state = random_value();
    let nonce = random_value();
    let verifier = random_value() + &random_value();
    let digest = ring::digest::digest(&ring::digest::SHA256, verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(digest.as_ref());
    let existing = load_profile(&app)?;
    let client_id = existing.as_ref().map(|p| p.client_id.as_str()).unwrap_or("dynamic_agent_client");
    let mut url = reqwest::Url::parse(AUTH_URL).map_err(|_| "Invalid auth URL")?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("client_id", client_id)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &redirect)
            .append_pair("scope", SCOPES)
            .append_pair("resource", RESOURCE)
            .append_pair("state", &state)
            .append_pair("nonce", &nonce)
            .append_pair("code_challenge_method", "S256")
            .append_pair("code_challenge", &challenge)
            .append_pair("ext_agent_host_id", &host_id(&app)?);
        if existing.is_none() { query.append_pair("agent_name_hint", "Veil"); }
        if let Some(profile) = &existing {
            query.append_pair("id_token_hint", &profile.id_token);
            if !status(Some(profile)).plan_enabled { query.append_pair("prompt", "consent"); }
        }
    }
    open_browser(url.as_str())?;
    let (mut stream, _) = tokio::time::timeout(std::time::Duration::from_secs(180), listener.accept())
        .await.map_err(|_| "ChatGPT sign-in timed out")?
        .map_err(|_| "ChatGPT callback failed")?;
    let mut request = vec![0u8; 8192];
    let length = stream.read(&mut request).await.map_err(|_| "Could not read callback")?;
    let first = String::from_utf8_lossy(&request[..length]);
    let path = first.split_whitespace().nth(1).ok_or("Invalid callback request")?;
    let callback = reqwest::Url::parse(&format!("http://127.0.0.1:{port}{path}"))
        .map_err(|_| "Invalid callback URL")?;
    if callback.path() != "/auth/callback" { return Err("Unexpected callback path".into()); }
    let params: std::collections::HashMap<_, _> = callback.query_pairs()
        .map(|(k,v)| (k.into_owned(), v.into_owned())).collect();
    let reply = b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\nChatGPT sign-in received. Return to Veil.";
    let _ = stream.write_all(reply).await;
    if params.get("state") != Some(&state) { return Err("ChatGPT sign-in state mismatch".into()); }
    if let Some(error) = params.get("error") { return Err(format!("ChatGPT sign-in declined: {error}")); }
    let code = params.get("code").ok_or("No ChatGPT authorization code")?;
    let issued = if existing.is_some() {
        if params.get("client_id").is_some_and(|id| id != client_id) {
            return Err("ChatGPT registration changed unexpectedly".into());
        }
        client_id.to_string()
    } else {
        params.get("client_id").filter(|id| id.starts_with("oaiapp_"))
            .ok_or("No issued ChatGPT client ID")?.to_string()
    };
    let client = reqwest::Client::new();
    let token_response = client.post(TOKEN_URL).form(&[
        ("grant_type", "authorization_code"),
        ("client_id", issued.as_str()),
        ("code", code.as_str()),
        ("code_verifier", verifier.as_str()),
        ("redirect_uri", redirect.as_str()),
        ("resource", RESOURCE),
    ]).send().await.map_err(|_| "ChatGPT token exchange failed")?;
    if !token_response.status().is_success() { return Err("ChatGPT token exchange was rejected".into()); }
    let tokens: Value = token_response.json().await.map_err(|_| "Invalid ChatGPT token response")?;
    let id_token = tokens["id_token"].as_str().ok_or("No ChatGPT identity token")?;
    let jwks: Value = client.get(JWKS_URL).send().await.map_err(|_| "Could not get ChatGPT signing keys")?
        .json().await.map_err(|_| "Invalid ChatGPT signing keys")?;
    let (subject, email) = verify_id_token(id_token, &issued, &nonce, &jwks)?;
    if existing.as_ref().is_some_and(|profile| profile.subject != subject) {
        return Err("A different ChatGPT account was selected. Sign out first".into());
    }
    let profile = Profile {
        client_id: issued,
        subject,
        email,
        id_token: id_token.into(),
        access_token: tokens["access_token"].as_str().ok_or("No ChatGPT access token")?.into(),
        refresh_token: tokens["refresh_token"].as_str().ok_or("No ChatGPT refresh token")?.into(),
        expires_at: now() + tokens["expires_in"].as_u64().unwrap_or(3600),
        scope: tokens["scope"].as_str().unwrap_or("").into(),
    };
    save_profile(&app, &profile)?;
    Ok(status(Some(&profile)))
}

#[tauri::command]
pub async fn chatgpt_plan_models(app: AppHandle) -> Result<Vec<String>, String> {
    let profile = fresh_profile(&app).await?;
    if !status(Some(&profile)).plan_enabled { return Err("ChatGPT plan usage was not granted".into()); }
    let response = reqwest::Client::new().get("https://api.openai.com/v1/models")
        .bearer_auth(&profile.access_token).send().await.map_err(|_| "Could not list ChatGPT models")?;
    if !response.status().is_success() { return Err("ChatGPT model listing was rejected".into()); }
    let models: Value = response.json().await.map_err(|_| "Invalid ChatGPT model list")?;
    Ok(models["models"].as_array().into_iter().flatten()
        .filter(|model| model["visibility"] == "list")
        .filter_map(|model| model["slug"].as_str().map(str::to_string)).collect())
}

#[tauri::command]
pub fn chatgpt_plan_cancel(request_id: String) {
    if let Ok(active) = ACTIVE.lock() {
        if let Some(sender) = active.get(&request_id) { let _ = sender.send(true); }
    }
}

#[tauri::command]
pub async fn chatgpt_plan_response(app: AppHandle, request_id: String, model: String,
    instructions: String, input: Value) -> Result<(), String>
{
    if !model.starts_with("gpt-") || model.len() > 100 { return Err("Invalid ChatGPT model".into()); }
    if !input.is_array() { return Err("Invalid ChatGPT input".into()); }
    let (sender, mut cancelled) = watch::channel(false);
    ACTIVE.lock().map_err(|_| "Request state unavailable")?.insert(request_id.clone(), sender);
    let _active = ActiveRequest(request_id.clone());
    let profile = tokio::select! {
        result = fresh_profile(&app) => result?,
        _ = cancelled.changed() => return Err("ChatGPT request cancelled".into()),
    };
    if !status(Some(&profile)).plan_enabled { return Err("ChatGPT plan usage was not granted".into()); }
    let send = reqwest::Client::new().post("https://api.openai.com/v1/responses")
        .bearer_auth(&profile.access_token)
        .json(&json!({"model": model, "instructions": instructions, "input": input,
            "store": false, "stream": true}))
        .send();
    let response = tokio::select! {
        result = send => result.map_err(|_| "Could not reach ChatGPT plan inference")?,
        _ = cancelled.changed() => return Err("ChatGPT request cancelled".into()),
    };
    if !response.status().is_success() {
        return Err(format!("ChatGPT plan request failed ({})", response.status()));
    }
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut completed = false;
    use futures_util::StreamExt;
    loop {
        let part = tokio::select! {
            result = stream.next() => result,
            _ = cancelled.changed() => return Err("ChatGPT request cancelled".into()),
        };
        let Some(part) = part else { break; };
        let part = part.map_err(|_| "ChatGPT response stream interrupted")?;
        buffer.push_str(&String::from_utf8_lossy(&part));
        while let Some(end) = buffer.find('\n') {
            let line = buffer.drain(..=end).collect::<String>();
            let Some(data) = line.trim().strip_prefix("data: ") else { continue; };
            let Ok(event) = serde_json::from_str::<Value>(data) else { continue; };
            match event["type"].as_str() {
                Some("response.output_text.delta") => {
                    if let Some(delta) = event["delta"].as_str() {
                        let _ = app.emit("chatgpt_plan_chunk", json!({"requestId": request_id, "text": delta}));
                    }
                }
                Some("response.completed") => { completed = true; }
                Some("response.failed") => {
                    return Err(format!("ChatGPT plan response failed: {}",
                        event["response"]["error"]["code"].as_str().unwrap_or("unknown")));
                }
                Some("response.incomplete") | Some("error") => {
                    return Err("ChatGPT plan response did not complete".into());
                }
                _ => {}
            }
        }
    }
    if !completed { return Err("ChatGPT plan stream ended before completion".into()); }
    Ok(())
}
