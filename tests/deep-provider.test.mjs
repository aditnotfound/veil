import test from "node:test";
import assert from "node:assert/strict";
import { selectedModelName, withModelOverride } from "../src/lib/call/deep-provider.ts";

test("deep model override is call-only and covers model/deployment templates", () => {
  const selected = { provider: "openrouter", variables: { API_KEY: "secret", MODEL: "fast" } };
  const deep = withModelOverride(selected, " strong-model ");
  assert.notEqual(deep, selected);
  assert.equal(selected.variables.MODEL, "fast");
  assert.equal(deep.variables.MODEL, "strong-model");
  assert.equal(deep.variables.deployment_name, "strong-model");
  assert.equal(selectedModelName(deep), "strong-model");
  assert.equal(withModelOverride(selected, ""), selected);
});
