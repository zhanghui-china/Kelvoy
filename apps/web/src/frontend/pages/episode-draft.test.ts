import { afterAll, afterEach, expect, test } from "bun:test";
import { clearDraft, draftForDestinationParam, readDraft, saveDraft, seasonAfterDestinationChange, selectDraftPersona, type EpisodeDraft } from "./episode-draft";

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
  saveDraft(draft, "u_a");
  selectDraftPersona("p_new", "u_a");
  expect(readDraft("u_a")).toEqual({ ...draft, personaId: "p_new" });
  clearDraft();
  expect(readDraft("u_a")).toBeNull();
});

test("invalid stored draft is ignored", () => {
  values.set("kelvoy_new_episode_draft", '{"name":"incomplete"}');
  expect(readDraft("u_a")).toBeNull();
});

test("a second account cannot read or alter the first account's draft", () => {
  saveDraft(draft, "u_a");
  expect(readDraft("u_b")).toBeNull();
  selectDraftPersona("p_b", "u_b");
  expect(readDraft("u_a")).toEqual(draft);
  saveDraft({ ...draft, name: "B 的项目" }, "u_b");
  expect(readDraft("u_a")).toBeNull();
  expect(readDraft("u_b")?.name).toBe("B 的项目");
});

test("explicit destination link overrides a restored place but keeps the independent brief", () => {
  expect(draftForDestinationParam(draft, "d_mountain")).toEqual({
    ...draft,
    destinationId: "d_mountain",
    templateId: "",
    seasonMode: "preset",
    season: "",
  });
  expect(draftForDestinationParam(draft, null)).toEqual(draft);
});

test("switching destinations preserves a custom season and updates a preset season", () => {
  expect(seasonAfterDestinationChange("custom", "初冬雪后", ["春季"])).toBe("初冬雪后");
  expect(seasonAfterDestinationChange("preset", "秋季", ["春季"])).toBe("春季");
});

afterAll(() => {
  if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
  else delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
});
