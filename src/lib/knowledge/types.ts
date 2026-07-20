export type KnowledgeSourceKind = "file" | "note";

export interface KnowledgeSource {
  id: string;
  title: string;
  kind: KnowledgeSourceKind;
  tags: string[];
  raw_text: string;
  created_at: number;
  updated_at: number;
}

export interface KnowledgeChunk {
  id: string;
  source_id: string;
  chunk_index: number;
  content: string;
  embedding: number[];
  created_at: number;
}

export interface KnowledgeSettings {
  enabled: boolean;
  focusTags: string[];
}
