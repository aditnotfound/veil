use keyring::{Entry, Error};
use std::sync::Mutex;
use tauri::AppHandle;

static SECRET_LOCK: Mutex<()> = Mutex::new(());
const MAX_SECRET_BYTES: usize = 2000;

fn service(identifier: &str) -> String {
    format!("{identifier}.provider")
}

fn entry(service: &str, kind: &str) -> Result<Entry, String> {
    let account = match kind {
        "ai" => "selected-ai-provider",
        "stt" => "selected-stt-provider",
        "jev" => "selected-jev-provider",
        _ => return Err("Unsupported credential kind".to_string()),
    };
    Entry::new(service, account).map_err(|_| "Credential store unavailable".to_string())
}

fn join_error() -> String {
    "Credential store task failed".to_string()
}

#[tauri::command]
pub async fn save_provider_secret(
    app: AppHandle,
    kind: String,
    secret: String,
) -> Result<(), String> {
    if secret.is_empty() || secret.len() > MAX_SECRET_BYTES {
        return Err("Provider credential is empty or too large for the OS store".to_string());
    }
    let service = service(&app.config().identifier);
    tokio::task::spawn_blocking(move || {
        let _guard = SECRET_LOCK
            .lock()
            .map_err(|_| "Credential store lock failed".to_string())?;
        let credential = entry(&service, &kind)?;
        credential
            .set_password(&secret)
            .map_err(|_| "Could not save provider credential".to_string())?;
        let verified = credential
            .get_password()
            .map_err(|_| "Could not verify provider credential".to_string())?;
        if verified != secret {
            return Err("Provider credential verification failed".to_string());
        }
        Ok(())
    })
    .await
    .map_err(|_| join_error())?
}

#[tauri::command]
pub async fn get_provider_secret(app: AppHandle, kind: String) -> Result<Option<String>, String> {
    let service = service(&app.config().identifier);
    tokio::task::spawn_blocking(move || {
        let _guard = SECRET_LOCK
            .lock()
            .map_err(|_| "Credential store lock failed".to_string())?;
        let credential = entry(&service, &kind)?;
        match credential.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(Error::NoEntry) => Ok(None),
            Err(_) => Err("Could not read provider credential".to_string()),
        }
    })
    .await
    .map_err(|_| join_error())?
}

#[tauri::command]
pub async fn remove_provider_secret(app: AppHandle, kind: String) -> Result<(), String> {
    let service = service(&app.config().identifier);
    tokio::task::spawn_blocking(move || {
        let _guard = SECRET_LOCK
            .lock()
            .map_err(|_| "Credential store lock failed".to_string())?;
        let credential = entry(&service, &kind)?;
        match credential.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(_) => Err("Could not remove provider credential".to_string()),
        }
    })
    .await
    .map_err(|_| join_error())?
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn windows_credential_manager_roundtrip() {
        let account = format!("veil-test-{}", uuid::Uuid::new_v4());
        let service = service("com.aditajpatil.veil");
        let credential = Entry::new(&service, &account).expect("create credential entry");
        let result = (|| -> Result<(), String> {
            credential
                .set_password("roundtrip-test")
                .map_err(|e| e.to_string())?;
            let loaded = credential.get_password().map_err(|e| e.to_string())?;
            if loaded != "roundtrip-test" {
                return Err("credential mismatch".to_string());
            }
            Ok(())
        })();
        let cleanup = credential.delete_credential();
        result.expect("Windows Credential Manager roundtrip");
        cleanup.expect("remove test credential");
    }

    #[test]
    fn credential_service_follows_bundle_identifier() {
        assert_eq!(
            service("com.aditajpatil.veil.smoke"),
            "com.aditajpatil.veil.smoke.provider"
        );
    }

    #[test]
    fn jev_credential_is_separate_from_answer_provider() {
        let service = service(&format!("com.aditajpatil.veil.test.{}", uuid::Uuid::new_v4()));
        let jev = entry(&service, "jev").expect("create Jev entry");
        let ai = entry(&service, "ai").expect("create AI entry");
        jev.set_password("jev-test-only").expect("save Jev fixture");
        let loaded = jev.get_password();
        let ai_loaded = ai.get_password();
        jev.delete_credential().expect("remove Jev fixture");
        assert_eq!(loaded.expect("read Jev fixture"), "jev-test-only");
        assert!(matches!(ai_loaded, Err(Error::NoEntry)));
    }
}
