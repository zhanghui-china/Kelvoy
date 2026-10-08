/** A generation distinguishes A → B → A navigation and invalidates unmounted work. */
export function createDraftOperationScope() {
  let route = "";
  let generation = 0;
  return {
    enter(id: string) { if (route !== id) { route = id; generation++; } },
    invalidate() { generation++; },
    capture() { const captured = generation; return () => captured === generation; },
  };
}
/** Save text first, then mutate using its returned version only while this view remains active. */
export async function saveThenMutateDraft<Result, Draft>(
  save: () => Promise<Result>,
  accept: (result: Result) => Draft | null,
  mutate: (saved: Draft, current: () => boolean) => Promise<void>,
  current: () => boolean,
): Promise<void> {
  const result = await save();
  if (!current()) return;
  const saved = accept(result);
  if (saved !== null && current()) await mutate(saved, current);
}
