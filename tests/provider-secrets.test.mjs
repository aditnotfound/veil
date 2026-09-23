import test from "node:test";
import assert from "node:assert/strict";
import { loadProviderSelection, saveProviderSelection } from "../src/lib/storage/provider-secrets.ts";

function stores(initial = {}) {
  const map = new Map(Object.entries(initial));
  const vaultMap = new Map();
  const local = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
  const vault = {
    get: async (kind) => vaultMap.get(kind) ?? null,
    save: async (kind, value) => { vaultMap.set(kind, value); },
    remove: async (kind) => { vaultMap.delete(kind); },
  };
  return { local, vault, map, vaultMap };
}

test("migration verifies OS storage before removing a legacy plaintext key", async () => {
  const key = "selected_stt";
  const selected = { provider: "deepgram-stt", variables: { api_key: "private-token", model: "nova-2" } };
  const s = stores({ [key]: JSON.stringify(selected) });
  const loaded = await loadProviderSelection("stt", key, s.local, s.vault);
  assert.deepEqual(loaded, selected);
  assert.deepEqual(JSON.parse(s.vaultMap.get("stt")), selected);
  assert.equal(s.local.getItem(key).includes("private-token"), false);
  assert.equal(JSON.parse(s.local.getItem(key)).provider, "deepgram-stt");
});

test("failed OS write retains the old credential for a later migration attempt", async () => {
  const key = "selected_ai";
  const raw = JSON.stringify({ provider: "openai", variables: { api_key: "old-secret" } });
  const s = stores({ [key]: raw });
  s.vault.save = async () => { throw new Error("locked"); };
  await assert.rejects(loadProviderSelection("ai", key, s.local, s.vault));
  assert.equal(s.local.getItem(key), raw);
});

test("new provider edits never put variables in webview localStorage", async () => {
  const s = stores();
  const selected = { provider: "openai", variables: { api_key: "new-secret", model: "gpt-6-sol" } };
  await saveProviderSelection("ai", "selected_ai", selected, s.local, s.vault);
  assert.equal(s.local.getItem("selected_ai").includes("new-secret"), false);
  assert.deepEqual(await loadProviderSelection("ai", "selected_ai", s.local, s.vault), selected);
  await saveProviderSelection("ai", "selected_ai", { provider: "", variables: {} }, s.local, s.vault);
  assert.equal(s.local.getItem("selected_ai"), null);
  assert.equal(await s.vault.get("ai"), null);
});

test("an existing OS credential supersedes and clears an old plaintext selection", async () => {
  const s = stores({ selected_ai: JSON.stringify({ provider: "old", variables: { api_key: "old-secret" } }) });
  const current = { provider: "openai", variables: { api_key: "current-secret" } };
  await s.vault.save("ai", JSON.stringify(current));
  assert.deepEqual(await loadProviderSelection("ai", "selected_ai", s.local, s.vault), current);
  assert.equal(s.local.getItem("selected_ai").includes("old-secret"), false);
});
