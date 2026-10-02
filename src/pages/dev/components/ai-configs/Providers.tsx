import { Button, Header, Input, Selection, TextInput } from "@/components";
import { UseSettingsReturn } from "@/types";
import curl2Json, { ResultJSON } from "@bany/curl-to-json";
import { useApp } from "@/contexts";
import { KeyIcon, TrashIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type ChatGPTPlanStatus = { connected: boolean; email?: string | null; plan_enabled: boolean };

export const Providers = ({
  allAiProviders,
  selectedAIProvider,
  onSetSelectedAIProvider,
  providerStorageError,
  variables,
}: UseSettingsReturn) => {
  const { jevApiKey, jevKeyError, saveJevApiKey, removeJevApiKey } = useApp();
  const [localSelectedProvider, setLocalSelectedProvider] =
    useState<ResultJSON | null>(null);
  const [jevKeyDraft, setJevKeyDraft] = useState("");
  const [jevKeySaving, setJevKeySaving] = useState(false);
  const [jevKeyStatus, setJevKeyStatus] = useState("");
  const [chatgptStatus, setChatgptStatus] = useState<ChatGPTPlanStatus | null>(null);
  const [chatgptModels, setChatgptModels] = useState<string[]>([]);
  const [chatgptBusy, setChatgptBusy] = useState(false);
  const [chatgptError, setChatgptError] = useState("");

  useEffect(() => {
    if (selectedAIProvider?.provider !== "chatgpt-plan") return;
    void invoke<ChatGPTPlanStatus>("chatgpt_plan_status")
      .then(setChatgptStatus, () => setChatgptError("Could not read ChatGPT connection."));
  }, [selectedAIProvider?.provider]);

  useEffect(() => {
    if (!chatgptStatus?.plan_enabled || selectedAIProvider?.provider !== "chatgpt-plan") return;
    void invoke<string[]>("chatgpt_plan_models")
      .then((models) => {
        setChatgptModels(models);
        if (models.length && !models.includes(selectedAIProvider.variables?.model || "")) {
          const preferred = models.find((model) => model === "gpt-6.1-sol")
            || models.find((model) => model === "gpt-6-sol") || models[0];
          onSetSelectedAIProvider({
            ...selectedAIProvider,
            variables: { ...selectedAIProvider.variables, model: preferred },
          });
        }
      }, () => setChatgptError("Could not list models for this ChatGPT account."));
  }, [chatgptStatus?.plan_enabled, selectedAIProvider?.provider]);

  useEffect(() => {
    if (selectedAIProvider?.provider) {
      const provider = allAiProviders?.find(
        (p) => p?.id === selectedAIProvider?.provider
      );
      if (provider) {
        const json = curl2Json(provider?.curl);
        setLocalSelectedProvider(json as ResultJSON);
      }
    }
  }, [selectedAIProvider?.provider]);

  const findKeyAndValue = (key: string) => {
    return variables?.find((v) => v?.key === key);
  };

  const getApiKeyValue = () => {
    const apiKeyVar = findKeyAndValue("api_key");
    if (!apiKeyVar || !selectedAIProvider?.variables) return "";
    return selectedAIProvider?.variables?.[apiKeyVar.key] || "";
  };

  const isApiKeyEmpty = () => {
    return !getApiKeyValue().trim();
  };

  return (
    <div className="space-y-3">
      {providerStorageError && <p role="alert" className="text-sm text-red-500">{providerStorageError}</p>}
      <div className="space-y-2">
        <Header
          title="Select answer provider"
          description="Choose OpenAI for the OpenAI answer key below, or another provider for answers. JEV has its own key field."
        />
        <Selection
          selected={selectedAIProvider?.provider}
          options={allAiProviders?.map((provider) => {
            const json = curl2Json(provider?.curl);
            return {
              label: provider?.isCustom
                ? json?.url || "Custom Provider"
                : provider?.id || "Custom Provider",
              value: provider?.id || "Custom Provider",
              isCustom: provider?.isCustom,
            };
          })}
          placeholder="Choose your AI provider"
          onChange={(value) => {
            onSetSelectedAIProvider({
              provider: value,
              variables: value === "openai" ? { model: "gpt-6-sol" }
                : value === "chatgpt-plan" ? { model: "gpt-6.1-sol" } : {},
            });
          }}
        />
      </div>

      {localSelectedProvider ? (
        <Header
          title={`Method: ${
            localSelectedProvider?.method || "Invalid"
          }, Endpoint: ${localSelectedProvider?.url || "Invalid"}`}
          description={`If you want to use different url or method, you can always create a custom provider.`}
        />
      ) : null}

      {findKeyAndValue("api_key") ? (
        <div className="space-y-2">
          <Header
            title={selectedAIProvider?.provider === "openai" ? "OpenAI API key" : "API Key"}
            description={`Enter your ${
              allAiProviders?.find(
                (p) => p?.id === selectedAIProvider?.provider
              )?.isCustom
                ? "Custom Provider"
                : selectedAIProvider?.provider
            } API key to authenticate and access AI models. Veil stores it in the OS credential store and sends it to the selected provider for requests.`}
          />

          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="**********"
                value={getApiKeyValue()}
                onChange={(value) => {
                  const apiKeyVar = findKeyAndValue("api_key");
                  if (!apiKeyVar || !selectedAIProvider) return;

                  onSetSelectedAIProvider({
                    ...selectedAIProvider,
                    variables: {
                      ...selectedAIProvider.variables,
                      [apiKeyVar.key]:
                        typeof value === "string" ? value : value.target.value,
                    },
                  });
                }}
                onKeyDown={(e) => {
                  const apiKeyVar = findKeyAndValue("api_key");
                  if (!apiKeyVar || !selectedAIProvider) return;

                  onSetSelectedAIProvider({
                    ...selectedAIProvider,
                    variables: {
                      ...selectedAIProvider.variables,
                      [apiKeyVar.key]: (e.target as HTMLInputElement).value,
                    },
                  });
                }}
                disabled={false}
                className="flex-1 h-11 border-1 border-input/50 focus:border-primary/50 transition-colors"
              />
              {isApiKeyEmpty() ? (
                <Button
                  onClick={() => {
                    const apiKeyVar = findKeyAndValue("api_key");
                    if (!apiKeyVar || !selectedAIProvider || isApiKeyEmpty())
                      return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [apiKeyVar.key]: getApiKeyValue(),
                      },
                    });
                  }}
                  disabled={isApiKeyEmpty()}
                  size="icon"
                  className="shrink-0 h-11 w-11"
                  title="Submit API Key"
                >
                  <KeyIcon className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    const apiKeyVar = findKeyAndValue("api_key");
                    if (!apiKeyVar || !selectedAIProvider) return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [apiKeyVar.key]: "",
                      },
                    });
                  }}
                  size="icon"
                  variant="destructive"
                  className="shrink-0 h-11 w-11"
                  title="Remove API Key"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-2 rounded-lg border border-border/50 p-3">
        <Header
          title="TypeSafe JEV API key"
          description="Separate from the OpenAI answer key. Veil stores this key in the OS credential store and sends it only to TypeSafe's System One API when you enable JEV comparison in Listen."
        />
        <div className="flex gap-2">
          <Input
            type="password"
            autoComplete="off"
            placeholder={jevApiKey ? "Key saved in OS credential store" : "Enter TypeSafe JEV key"}
            value={jevKeyDraft}
            onChange={(value) => {
              setJevKeyDraft(typeof value === "string" ? value : value.target.value);
              setJevKeyStatus("");
            }}
            className="flex-1 h-11 border-1 border-input/50 focus:border-primary/50 transition-colors"
          />
          <Button
            type="button"
            disabled={jevKeySaving || !jevKeyDraft.trim()}
            onClick={async () => {
              setJevKeySaving(true);
              setJevKeyStatus("");
              try {
                await saveJevApiKey(jevKeyDraft);
                setJevKeyDraft("");
                setJevKeyStatus("TypeSafe JEV key saved.");
              } catch {
                setJevKeyStatus("Could not save the TypeSafe JEV key.");
              } finally {
                setJevKeySaving(false);
              }
            }}
          >
            Save
          </Button>
          {jevApiKey && (
            <Button
              type="button"
              variant="destructive"
              disabled={jevKeySaving}
              onClick={async () => {
                setJevKeySaving(true);
                setJevKeyStatus("");
                try {
                  await removeJevApiKey();
                  setJevKeyDraft("");
                  setJevKeyStatus("TypeSafe JEV key removed.");
                } catch {
                  setJevKeyStatus("Could not remove the TypeSafe JEV key.");
                } finally {
                  setJevKeySaving(false);
                }
              }}
            >
              Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {jevApiKey ? "JEV key configured." : "JEV key not configured."}
        </p>
        {(jevKeyError || jevKeyStatus) && (
          <p role={jevKeyError || jevKeyStatus.startsWith("Could not") ? "alert" : "status"} className="text-xs text-muted-foreground">
            {jevKeyError || jevKeyStatus}
          </p>
        )}
      </div>

      {selectedAIProvider?.provider === "chatgpt-plan" && (
        <div className="space-y-3 rounded-lg border border-border/50 p-3">
          <Header title="ChatGPT plan for answers"
            description="Connect an eligible Plus or Pro account. Answer requests use your ChatGPT plan allowance; transcription and embeddings still need their own configured provider." />
          <p className="text-xs text-muted-foreground">
            {chatgptStatus?.connected
              ? `Connected: ${chatgptStatus.email || "ChatGPT account"}. Plan usage ${chatgptStatus.plan_enabled ? "enabled" : "not granted"}.`
              : "No ChatGPT account connected."}
          </p>
          <div className="flex gap-2">
            <Button type="button" disabled={chatgptBusy} onClick={async () => {
              setChatgptBusy(true);
              setChatgptError("");
              try {
                const next = await invoke<ChatGPTPlanStatus>("chatgpt_plan_sign_in");
                setChatgptStatus(next);
              } catch (error) {
                setChatgptError(String(error));
              } finally {
                setChatgptBusy(false);
              }
            }}>Continue with ChatGPT</Button>
            {chatgptStatus?.connected && <Button type="button" variant="destructive"
              disabled={chatgptBusy} onClick={async () => {
                setChatgptBusy(true);
                setChatgptError("");
                try {
                  await invoke("chatgpt_plan_sign_out");
                  setChatgptStatus({ connected: false, plan_enabled: false });
                  setChatgptModels([]);
                } catch (error) { setChatgptError(String(error)); }
                finally { setChatgptBusy(false); }
              }}>Sign out locally</Button>}
          </div>
          {chatgptStatus?.connected && <p className="text-xs text-muted-foreground">
            Manage or revoke Veil's plan access in ChatGPT Settings → Usage.
          </p>}
          {chatgptBusy && <p role="status" className="text-xs text-muted-foreground">Complete sign-in in your browser, then return to Veil.</p>}
          {chatgptModels.length > 0 && <div className="space-y-1">
            <label htmlFor="chatgpt-plan-model" className="text-xs font-medium">Answer model</label>
            <select id="chatgpt-plan-model" className="w-full rounded border border-input bg-background p-2 text-sm"
              value={selectedAIProvider.variables?.model || ""}
              onChange={(event) => onSetSelectedAIProvider({
                ...selectedAIProvider,
                variables: { ...selectedAIProvider.variables, model: event.target.value },
              })}>
              {!chatgptModels.includes(selectedAIProvider.variables?.model || "") &&
                <option value={selectedAIProvider.variables?.model || ""}>Choose an available model</option>}
              {chatgptModels.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </div>}
          {chatgptError && <p role="alert" className="text-xs text-red-500">{chatgptError}</p>}
        </div>
      )}

      <div className="space-y-4 mt-2">
        {variables
          .filter(
            (variable) => variable.key !== findKeyAndValue("api_key")?.key &&
              !(selectedAIProvider?.provider === "chatgpt-plan" && variable.key === "model")
          )
          .map((variable) => {
            const getVariableValue = () => {
              if (!variable?.key || !selectedAIProvider?.variables) return "";
              return selectedAIProvider.variables[variable.key] || "";
            };

            return (
              <div className="space-y-1" key={variable?.key}>
                <Header
                  title={variable?.value || ""}
                  description={`add your preferred ${variable?.key?.replace(
                    /_/g,
                    " "
                  )} for ${
                    allAiProviders?.find(
                      (p) => p?.id === selectedAIProvider?.provider
                    )?.isCustom
                      ? "Custom Provider"
                      : selectedAIProvider?.provider
                  }`}
                />
                <TextInput
                  placeholder={`Enter ${
                    allAiProviders?.find(
                      (p) => p?.id === selectedAIProvider?.provider
                    )?.isCustom
                      ? "Custom Provider"
                      : selectedAIProvider?.provider
                  } ${variable?.key?.replace(/_/g, " ") || "value"}`}
                  value={getVariableValue()}
                  onChange={(value) => {
                    if (!variable?.key || !selectedAIProvider) return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [variable.key]: value,
                      },
                    });
                  }}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
};
