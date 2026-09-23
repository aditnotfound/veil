export interface SelectedProviderConfig {
  provider: string;
  variables: Record<string, string>;
}

const MODEL_KEYS = [
  "model", "MODEL", "model_name", "MODEL_NAME",
  "deployment", "DEPLOYMENT", "deployment_name", "DEPLOYMENT_NAME",
];

/** Apply a call-only model/deployment override without mutating saved provider settings. */
export function withModelOverride<T extends SelectedProviderConfig>(
  selected: T,
  override: string
): T {
  const value = override.trim();
  if (!value) return selected;
  const variables = { ...selected.variables };
  for (const key of MODEL_KEYS) variables[key] = value;
  return { ...selected, variables };
}

export function selectedModelName(selected: SelectedProviderConfig): string {
  const variables = selected.variables ?? {};
  return variables.model || variables.MODEL || variables.model_name || variables.MODEL_NAME ||
    variables.deployment || variables.DEPLOYMENT || variables.deployment_name ||
    variables.DEPLOYMENT_NAME || "";
}
