import { getDatabase } from "./config";

export interface Meeting {
  id: string;
  title: string;
  transcript: string;
  summary: string;
  notes: string;
  created_at: number;
  updated_at: number;
}

export type MeetingInput = {
  title: string;
  transcript?: string;
  summary?: string;
  notes?: string;
};

export type MeetingUpdate = Partial<
  Pick<Meeting, "title" | "transcript" | "summary" | "notes">
>;

function newId() {
  return `mtg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function listMeetings(): Promise<Meeting[]> {
  const db = await getDatabase();
  return db.select<Meeting[]>(
    "SELECT * FROM meetings ORDER BY updated_at DESC"
  );
}

export async function getMeetingById(id: string): Promise<Meeting | null> {
  const db = await getDatabase();
  const rows = await db.select<Meeting[]>(
    "SELECT * FROM meetings WHERE id = ?",
    [id]
  );
  return rows[0] || null;
}

export async function createMeeting(input: MeetingInput): Promise<Meeting> {
  const db = await getDatabase();
  const now = Date.now();
  const id = newId();
  const title = input.title.trim() || "Untitled meeting";
  const transcript = input.transcript?.trim() || "";
  const summary = input.summary?.trim() || "";
  const notes = input.notes?.trim() || "";

  await db.execute(
    `INSERT INTO meetings (id, title, transcript, summary, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, title, transcript, summary, notes, now, now]
  );

  const created = await getMeetingById(id);
  if (!created) throw new Error("Failed to retrieve created meeting");
  return created;
}

export async function updateMeeting(
  id: string,
  input: MeetingUpdate
): Promise<Meeting> {
  const db = await getDatabase();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.title !== undefined) {
    updates.push("title = ?");
    values.push(input.title.trim() || "Untitled meeting");
  }
  if (input.transcript !== undefined) {
    updates.push("transcript = ?");
    values.push(input.transcript);
  }
  if (input.summary !== undefined) {
    updates.push("summary = ?");
    values.push(input.summary);
  }
  if (input.notes !== undefined) {
    updates.push("notes = ?");
    values.push(input.notes);
  }

  if (updates.length === 0) {
    const existing = await getMeetingById(id);
    if (!existing) throw new Error("Meeting not found");
    return existing;
  }

  updates.push("updated_at = ?");
  values.push(Date.now());
  values.push(id);

  await db.execute(
    `UPDATE meetings SET ${updates.join(", ")} WHERE id = ?`,
    values
  );

  const updated = await getMeetingById(id);
  if (!updated) throw new Error("Meeting not found after update");
  return updated;
}

export async function deleteMeeting(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM meetings WHERE id = ?", [id]);
}
