export interface SystemPrompt {
  id: number;
  name: string;
  prompt: string;
  created_at: string;
  updated_at: string;
  category?: string | null;
  recommended_model?: string | null;
  recommended_provider?: string | null;
  blurb?: string | null;
  is_default?: number | null;
}

export interface SystemPromptInput {
  name: string;
  prompt: string;
  category?: string | null;
  recommended_model?: string | null;
  recommended_provider?: string | null;
  blurb?: string | null;
  is_default?: number | null;
}

export interface UpdateSystemPromptInput {
  name?: string;
  prompt?: string;
  category?: string | null;
  recommended_model?: string | null;
  recommended_provider?: string | null;
  blurb?: string | null;
  is_default?: number | null;
}

export interface ListenMode {
  id: string;
  label: string;
  prompt_id: number | null;
  sort_order: number;
  is_builtin: number;
}

export interface ListenModeWithPrompt extends ListenMode {
  prompt_name?: string | null;
  prompt_text?: string | null;
  recommended_model?: string | null;
  recommended_provider?: string | null;
  blurb?: string | null;
}
