export type ProviderKind = "ai" | "stt";
export type SelectedProvider = { provider: string; variables: Record<string, string> };

export interface ProviderVault {
  get(kind: ProviderKind): Promise<string | null>;
  save(kind: ProviderKind, value: string): Promise<void>;
  remove(kind: ProviderKind): Promise<void>;
}

export interface ProviderPointerStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function parseSelection(raw: string | null): SelectedProvider | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value.provider !== "string" || !value.variables ||
      typeof value.variables !== "object" || Array.isArray(value.variables)) return null;
    if (!Object.values(value.variables).every((item) => typeof item === "string")) return null;
    return { provider: value.provider, variables: value.variables };
  } catch {
    return null;
  }
}

let pointerRevision = 0;

function pointer(provider: string): string {
  return JSON.stringify({ provider, revision: `${Date.now()}-${++pointerRevision}` });
}

/** Move an old selected provider to the OS store before deleting its plaintext variables. */
export async function loadProviderSelection(
  kind: ProviderKind, key: string, local: ProviderPointerStore, vault: ProviderVault
): Promise<SelectedProvider> {
  const localRaw = local.getItem(key);
  const legacy = parseSelection(localRaw);
  const vaultedRaw = await vault.get(kind);
  if (vaultedRaw !== null) {
    const vaulted = parseSelection(vaultedRaw);
    if (!vaulted) throw new Error("Saved provider credential is invalid");
    if (legacy?.variables && Object.keys(legacy.variables).length) {
      local.setItem(key, pointer(vaulted.provider));
    }
    return vaulted;
  }
  if (legacy && Object.keys(legacy.variables).length) {
    await vault.save(kind, JSON.stringify(legacy));
    local.setItem(key, pointer(legacy.provider));
    return legacy;
  }
  // A previous provider pointer without a matching OS credential needs setup again.
  return { provider: legacy?.provider || "", variables: {} };
}

/** Never write variables to webview storage, even when the OS store is unavailable. */
export async function saveProviderSelection(
  kind: ProviderKind, key: string, selected: SelectedProvider,
  local: ProviderPointerStore, vault: ProviderVault
): Promise<void> {
  if (!selected.provider) {
    await vault.remove(kind);
    local.removeItem(key);
    return;
  }
  await vault.save(kind, JSON.stringify(selected));
  local.setItem(key, pointer(selected.provider));
}
