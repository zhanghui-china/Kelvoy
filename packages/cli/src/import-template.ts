import { validateTemplate } from "@kelvoy/engine";
import { upsertTemplate } from "@kelvoy/store";

export interface ImportTemplateResult {
  ok: boolean;
  template_id?: string;
  errors?: string[];
}

/**
 * Validates then upserts a template (M2-1). Never writes on any
 * validation error — same discipline as import-destination.ts.
 */
export async function importTemplate(raw: unknown): Promise<ImportTemplateResult> {
  const result = validateTemplate(raw);
  if (!result.valid) {
    return { ok: false, errors: result.errors };
  }
  await upsertTemplate(result.value);
  return { ok: true, template_id: result.value.template_id };
}
