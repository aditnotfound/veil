import { getDatabase } from "./config";

export interface AppNote {
  id: string;
  title: string;
  body: string;
  created_at: number;
  updated_at: number;
}

export type AppNoteInput = {
  title: string;
  body?: string;
};

export type AppNoteUpdate = Partial<Pick<AppNote, "title" | "body">>;

function newId() {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function listAppNotes(): Promise<AppNote[]> {
  const db = await getDatabase();
  return db.select<AppNote[]>(
    "SELECT * FROM app_notes ORDER BY updated_at DESC"
  );
}

export async function getAppNoteById(id: string): Promise<AppNote | null> {
  const db = await getDatabase();
  const rows = await db.select<AppNote[]>(
    "SELECT * FROM app_notes WHERE id = ?",
    [id]
  );
  return rows[0] || null;
}

export async function createAppNote(input: AppNoteInput): Promise<AppNote> {
  const db = await getDatabase();
  const now = Date.now();
  const id = newId();
  const title = input.title.trim() || "Untitled note";
  const body = input.body?.trim() || "";

  await db.execute(
    `INSERT INTO app_notes (id, title, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, title, body, now, now]
  );

  const created = await getAppNoteById(id);
  if (!created) throw new Error("Failed to retrieve created note");
  return created;
}

export async function updateAppNote(
  id: string,
  input: AppNoteUpdate
): Promise<AppNote> {
  const db = await getDatabase();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.title !== undefined) {
    updates.push("title = ?");
    values.push(input.title.trim() || "Untitled note");
  }
  if (input.body !== undefined) {
    updates.push("body = ?");
    values.push(input.body);
  }

  if (updates.length === 0) {
    const existing = await getAppNoteById(id);
    if (!existing) throw new Error("Note not found");
    return existing;
  }

  updates.push("updated_at = ?");
  values.push(Date.now());
  values.push(id);

  await db.execute(
    `UPDATE app_notes SET ${updates.join(", ")} WHERE id = ?`,
    values
  );

  const updated = await getAppNoteById(id);
  if (!updated) throw new Error("Note not found after update");
  return updated;
}

export async function deleteAppNote(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM app_notes WHERE id = ?", [id]);
}
