import { getDatabase } from "./config";
import {
  VEIL_DEFAULT_PROMPTS,
  VEIL_LISTEN_MODE_NAMES,
} from "@/config";
import type {
  ListenMode,
  ListenModeWithPrompt,
  SystemPrompt,
  SystemPromptInput,
  UpdateSystemPromptInput,
} from "@/types";

let hasExtendedPromptColumns: boolean | null = null;
let hasListenModesTable: boolean | null = null;

async function detectExtendedPromptColumns(): Promise<boolean> {
  if (hasExtendedPromptColumns !== null) return hasExtendedPromptColumns;
  try {
    const db = await getDatabase();
    const cols = await db.select<{ name: string }[]>(
      "PRAGMA table_info(system_prompts)"
    );
    const names = new Set(cols.map((c) => c.name));
    hasExtendedPromptColumns =
      names.has("category") &&
      names.has("recommended_model") &&
      names.has("recommended_provider") &&
      names.has("blurb") &&
      names.has("is_default");
  } catch {
    hasExtendedPromptColumns = false;
  }
  return hasExtendedPromptColumns;
}

async function detectListenModesTable(): Promise<boolean> {
  if (hasListenModesTable !== null) return hasListenModesTable;
  try {
    const db = await getDatabase();
    const rows = await db.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='listen_modes'"
    );
    hasListenModesTable = rows.length > 0;
  } catch {
    hasListenModesTable = false;
  }
  return hasListenModesTable;
}

/**
 * Create a new system prompt
 */
export async function createSystemPrompt(
  input: SystemPromptInput
): Promise<SystemPrompt> {
  const db = await getDatabase();

  const name = input.name.trim();
  const prompt = input.prompt.trim();

  if (!name) {
    throw new Error("System prompt name cannot be empty");
  }

  if (!prompt) {
    throw new Error("System prompt text cannot be empty");
  }

  const extended = await detectExtendedPromptColumns();

  let result;
  if (extended) {
    result = await db.execute(
      `INSERT INTO system_prompts
        (name, prompt, category, recommended_model, recommended_provider, blurb, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        prompt,
        input.category ?? null,
        input.recommended_model ?? null,
        input.recommended_provider ?? null,
        input.blurb ?? null,
        input.is_default ?? 0,
      ]
    );
  } else {
    result = await db.execute(
      "INSERT INTO system_prompts (name, prompt) VALUES (?, ?)",
      [name, prompt]
    );
  }

  const inserted = await db.select<SystemPrompt[]>(
    "SELECT * FROM system_prompts WHERE id = ?",
    [result.lastInsertId]
  );

  if (!inserted[0]) {
    throw new Error("Failed to retrieve created system prompt");
  }

  return inserted[0];
}

/**
 * Get all system prompts
 */
export async function getAllSystemPrompts(): Promise<SystemPrompt[]> {
  const db = await getDatabase();
  try {
    return await db.select<SystemPrompt[]>(
      "SELECT * FROM system_prompts ORDER BY created_at DESC"
    );
  } catch (err) {
    // Transition: fall back if schema is unexpected
    console.warn("getAllSystemPrompts failed, retrying basic select:", err);
    return await db.select<SystemPrompt[]>(
      "SELECT id, name, prompt, created_at, updated_at FROM system_prompts ORDER BY created_at DESC"
    );
  }
}

/**
 * Get a single system prompt by ID
 */
export async function getSystemPromptById(
  id: number
): Promise<SystemPrompt | null> {
  const db = await getDatabase();
  const result = await db.select<SystemPrompt[]>(
    "SELECT * FROM system_prompts WHERE id = ?",
    [id]
  );
  return result[0] || null;
}

/**
 * Update a system prompt
 */
export async function updateSystemPrompt(
  id: number,
  input: UpdateSystemPromptInput
): Promise<SystemPrompt> {
  const db = await getDatabase();
  const extended = await detectExtendedPromptColumns();

  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) {
      throw new Error("System prompt name cannot be empty");
    }
    updates.push("name = ?");
    values.push(name);
  }

  if (input.prompt !== undefined) {
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new Error("System prompt text cannot be empty");
    }
    updates.push("prompt = ?");
    values.push(prompt);
  }

  if (extended) {
    if (input.category !== undefined) {
      updates.push("category = ?");
      values.push(input.category);
    }
    if (input.recommended_model !== undefined) {
      updates.push("recommended_model = ?");
      values.push(input.recommended_model);
    }
    if (input.recommended_provider !== undefined) {
      updates.push("recommended_provider = ?");
      values.push(input.recommended_provider);
    }
    if (input.blurb !== undefined) {
      updates.push("blurb = ?");
      values.push(input.blurb);
    }
    if (input.is_default !== undefined) {
      updates.push("is_default = ?");
      values.push(input.is_default);
    }
  }

  if (updates.length === 0) {
    throw new Error("No fields to update");
  }

  values.push(id);

  await db.execute(
    `UPDATE system_prompts SET ${updates.join(", ")} WHERE id = ?`,
    values
  );

  const result = await db.select<SystemPrompt[]>(
    "SELECT * FROM system_prompts WHERE id = ?",
    [id]
  );

  if (!result[0]) {
    throw new Error("System prompt not found after update");
  }

  return result[0];
}

/**
 * Delete a system prompt
 */
export async function deleteSystemPrompt(id: number): Promise<void> {
  const db = await getDatabase();
  const result = await db.execute("DELETE FROM system_prompts WHERE id = ?", [
    id,
  ]);

  if (result.rowsAffected === 0) {
    throw new Error("System prompt not found");
  }
}

/**
 * Seed curated Veil default prompts + built-in listen modes (once).
 * Idempotent: skips if any is_default=1 prompt already exists.
 */
export async function seedVeilDefaultPrompts(): Promise<{
  seeded: boolean;
  promptCount: number;
  modeCount: number;
}> {
  const extended = await detectExtendedPromptColumns();
  const hasModes = await detectListenModesTable();

  if (!extended) {
    return { seeded: false, promptCount: 0, modeCount: 0 };
  }

  const db = await getDatabase();

  const existingDefaults = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM system_prompts WHERE is_default = 1"
  );
  if ((existingDefaults[0]?.count ?? 0) > 0) {
    return { seeded: false, promptCount: 0, modeCount: 0 };
  }

  const insertedByName = new Map<string, number>();

  for (const pack of VEIL_DEFAULT_PROMPTS) {
    const result = await db.execute(
      `INSERT INTO system_prompts
        (name, prompt, category, recommended_model, recommended_provider, blurb, is_default)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        pack.name,
        pack.prompt,
        pack.category,
        pack.recommended_model,
        pack.recommended_provider,
        pack.blurb,
      ]
    );
    if (result.lastInsertId != null) {
      insertedByName.set(pack.name, result.lastInsertId);
    }
  }

  let modeCount = 0;
  if (hasModes) {
    const modeNames = VEIL_LISTEN_MODE_NAMES;
    for (let i = 0; i < modeNames.length; i++) {
      const name = modeNames[i];
      const promptId = insertedByName.get(name) ?? null;
      const id = name.toLowerCase().replace(/\s+/g, "-");
      await db.execute(
        `INSERT OR IGNORE INTO listen_modes (id, label, prompt_id, sort_order, is_builtin)
         VALUES (?, ?, ?, ?, 1)`,
        [id, name, promptId, i]
      );
      modeCount += 1;
    }
  }

  return {
    seeded: true,
    promptCount: insertedByName.size,
    modeCount,
  };
}

/**
 * List listen modes ordered by sort_order
 */
export async function listListenModes(): Promise<ListenModeWithPrompt[]> {
  if (!(await detectListenModesTable())) {
    return [];
  }

  const db = await getDatabase();
  const extended = await detectExtendedPromptColumns();

  if (extended) {
    return await db.select<ListenModeWithPrompt[]>(
      `SELECT
         lm.id,
         lm.label,
         lm.prompt_id,
         lm.sort_order,
         lm.is_builtin,
         sp.name as prompt_name,
         sp.prompt as prompt_text,
         sp.recommended_model,
         sp.recommended_provider,
         sp.blurb
       FROM listen_modes lm
       LEFT JOIN system_prompts sp ON sp.id = lm.prompt_id
       ORDER BY lm.sort_order ASC, lm.label ASC`
    );
  }

  return await db.select<ListenModeWithPrompt[]>(
    `SELECT
       lm.id,
       lm.label,
       lm.prompt_id,
       lm.sort_order,
       lm.is_builtin,
       sp.name as prompt_name,
       sp.prompt as prompt_text
     FROM listen_modes lm
     LEFT JOIN system_prompts sp ON sp.id = lm.prompt_id
     ORDER BY lm.sort_order ASC, lm.label ASC`
  );
}

/**
 * Swap sort_order with the neighbor above (direction=-1) or below (direction=1)
 */
export async function reorderListenMode(
  id: string,
  direction: -1 | 1
): Promise<ListenMode[]> {
  if (!(await detectListenModesTable())) {
    throw new Error("listen_modes table is not available");
  }

  const db = await getDatabase();
  const modes = await db.select<ListenMode[]>(
    "SELECT * FROM listen_modes ORDER BY sort_order ASC, label ASC"
  );
  const index = modes.findIndex((m) => m.id === id);
  if (index < 0) {
    throw new Error("Listen mode not found");
  }

  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= modes.length) {
    return modes;
  }

  const current = modes[index];
  const neighbor = modes[targetIndex];
  const currentOrder = current.sort_order;
  const neighborOrder = neighbor.sort_order;

  // If sort_orders collide, reassign sequential orders after swap
  if (currentOrder === neighborOrder) {
    const reordered = [...modes];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    for (let i = 0; i < reordered.length; i++) {
      await db.execute("UPDATE listen_modes SET sort_order = ? WHERE id = ?", [
        i,
        reordered[i].id,
      ]);
    }
  } else {
    await db.execute("UPDATE listen_modes SET sort_order = ? WHERE id = ?", [
      neighborOrder,
      current.id,
    ]);
    await db.execute("UPDATE listen_modes SET sort_order = ? WHERE id = ?", [
      currentOrder,
      neighbor.id,
    ]);
  }

  return await db.select<ListenMode[]>(
    "SELECT * FROM listen_modes ORDER BY sort_order ASC, label ASC"
  );
}

/**
 * Remove a listen mode (does not delete the linked prompt)
 */
export async function removeListenMode(id: string): Promise<void> {
  if (!(await detectListenModesTable())) {
    throw new Error("listen_modes table is not available");
  }

  const db = await getDatabase();
  const result = await db.execute("DELETE FROM listen_modes WHERE id = ?", [
    id,
  ]);
  if (result.rowsAffected === 0) {
    throw new Error("Listen mode not found");
  }
}

/**
 * Point a listen mode at a system prompt (or clear with null)
 */
export async function setListenModePrompt(
  id: string,
  promptId: number | null
): Promise<ListenMode> {
  if (!(await detectListenModesTable())) {
    throw new Error("listen_modes table is not available");
  }

  const db = await getDatabase();

  if (promptId !== null) {
    const prompt = await getSystemPromptById(promptId);
    if (!prompt) {
      throw new Error("System prompt not found");
    }
  }

  await db.execute("UPDATE listen_modes SET prompt_id = ? WHERE id = ?", [
    promptId,
    id,
  ]);

  const rows = await db.select<ListenMode[]>(
    "SELECT * FROM listen_modes WHERE id = ?",
    [id]
  );
  if (!rows[0]) {
    throw new Error("Listen mode not found");
  }
  return rows[0];
}
