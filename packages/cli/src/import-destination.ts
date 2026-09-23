import { upsertDestination } from "@kelvoy/store";
import { validateDestination } from "./validate-destination";

export interface ImportResult {
  ok: boolean;
  destination_id?: string;
  errors?: string[];
}

/**
 * Validates then upserts a destination pack (M1-2). Never writes on any
 * validation error — see validate-destination.ts for the full rule set.
 */
export async function importDestination(raw: unknown): Promise<ImportResult> {
  const result = validateDestination(raw);
  if (!result.valid) {
    return { ok: false, errors: result.errors };
  }
  await upsertDestination(result.value);
  return { ok: true, destination_id: result.value.destination_id };
}
