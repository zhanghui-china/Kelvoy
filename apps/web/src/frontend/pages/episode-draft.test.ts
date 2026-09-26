import { afterAll, afterEach, expect, test } from "bun:test";
import { clearDraft, readDraft, saveDraft, selectDraftPersona, type EpisodeDraft } from "./episode-draft";

const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
const values = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  },
});
afterEach(() => values.clear());

const draft: EpisodeDraft = {
  personaId: "p_old", destinationId: "d_lake", templateId: "t_1", seasonMode: "custom",
  season: "早春", tone: "松弛", banned: ["真人", "可读文字"], outfitOverride: "蓝色外套",
  candidates: 3, name: "湖边漫游", requirements: "傍晚拍摄", aspect: "16:9",
};

test("new episode draft survives a persona creation trip with every creation parameter", () => {
  saveDraft(draft);
  selectDraftPersona("p_new");
  expect(readDraft()).toEqual({ ...draft, personaId: "p_new" });
  clearDraft();
  expect(readDraft()).toBeNull();
});

test("invalid stored draft is ignored", () => {
  values.set("kelvoy_new_episode_draft", '{"name":"incomplete"}');
  expect(readDraft()).toBeNull();
});

afterAll(() => {
  if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
  else delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
});
