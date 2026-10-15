import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { destinationFixture, fixture, personaFixture, shotFixture } from "../../server/routes/episode-test-fixtures";
import { patchShot } from "../api/client";
import { EpisodeDetailContent } from "../pages/EpisodeDetailPage";
import type { EpisodeMutation } from "./useEpisodeMutation";

function render(status: "failed" | "kf_selected" | "kf_ready" | "approved", options: {
  pending?: boolean; busy?: boolean; scripting?: boolean; generating?: boolean;
  candidates?: string[]; selected?: string; landmark?: string | null; withRefs?: boolean; outfitId?: string; empty?: boolean;
} = {}) {
  const base = fixture("e_save", "owner");
  const episode = { ...base, brief: { ...base.brief, ...(options.outfitId ? { outfit_id: options.outfitId } : {}) }, status: options.generating ? "keyframing" as const : "kf_review" as const,
    script_pending_task_id: options.scripting ? "task" : undefined,
    shots: [shotFixture(1, { status, kf_prompt: "山顶晨光",
      candidates: options.candidates ?? [], kf_selected: options.selected ?? null,
      landmark: options.landmark === undefined ? null : options.landmark,
      ...(options.empty ? { person_visible: false as const } : {}) })] };
  const mutation = { pending: !!options.pending, error: null, clearError() {}, async run() { return null; } } as EpisodeMutation;
  return renderToStaticMarkup(<StaticRouter location="/episodes/e_save">
    <EpisodeDetailContent episode={episode}
      destination={options.withRefs ? destinationFixture("d_test") : null}
      persona={options.withRefs ? { ...personaFixture("c_test", "owner"), outfits: [
        { outfit_id: "o_1", name: "秋日风衣", desc: "", seasons: ["秋"], refs: ["persona/c_test/o_1.png"] }] } : null} mutation={mutation} storyboardBusy={options.busy} />
  </StaticRouter>);
}

test.each(["failed", "kf_selected", "kf_ready", "approved"] as const)("%s allows saving the current description independent of regeneration", (status) => {
  const html = render(status);
  const save = html.match(/<button[^>]*>保存关键帧描述<\/button>/)?.[0];
  expect(save).toBeDefined();
  expect(save).not.toContain("disabled");
  expect(html).toContain("内容未变时留在当前审核");
  if (status === "failed" || status === "kf_selected") expect(html).toContain('disabled="">直接重生成</button>');
});

test.each([
  [{ busy: true }, "生成任务正在处理中"],
  [{ scripting: true }, "脚本任务正在处理"],
  [{ generating: true }, "当前不在关键帧审核"],
  [{ pending: true }, "操作正在提交"],
] as const)("edit and save share the lock: %s", (options, reason) => {
  const html = render("kf_ready", options);
  for (const label of ["修改关键帧描述", "保存关键帧描述"]) {
    expect(html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0]).toContain('disabled=""');
  }
  expect(html).toContain(reason);
});

test("candidate cards pair a zoom button with a separate pick button, labelled by order", () => {
  const keys = ["kf/s1_gen_abcdef_1.png", "kf/s1_gen_abcdef_2.png", "kf/s1_gen_abcdef_3.png"];
  const html = render("kf_selected", { candidates: keys, selected: keys[1] });
  const cards = [...html.matchAll(/<div[^>]*k-desk-candidate[^>]*>[\s\S]*?<\/button><\/div>/g)].map((m) => m[0]);
  expect(cards).toHaveLength(3);
  for (const [i, card] of cards.entries()) {
    const buttons = [...card.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);
    expect(buttons).toHaveLength(2); // no nested buttons: zoom and pick are siblings
    expect(buttons[0]).toContain(`aria-label="放大查看第 1 镜候选 ${i + 1}"`);
    expect(buttons[0]).toContain(`alt="第 1 镜候选 ${i + 1}"`);
    expect(buttons[1]).toContain(`aria-pressed="${i === 1}"`);
    expect(buttons[1].replace(/<[^>]*>/g, "")).toBe(`候选 ${i + 1} · ${i === 1 ? "已选定" : "选这张"}`);
  }
  // The full key stays reachable for debugging, but only as a tooltip.
  expect(cards[0]).toContain(`title="${keys[0]}"`);
  expect(html.replace(/<[^>]*>/g, "")).not.toContain(".png");
});

test("approved shots keep the pick buttons disabled but zoom stays available", () => {
  const html = render("approved", { candidates: ["kf/a.png", "kf/b.png"], selected: "kf/a.png" });
  expect(html).toContain('aria-label="放大查看第 1 镜候选 1"');
  expect(html.match(/<button[^>]*aria-label="放大查看[^"]*"[^>]*>/g)?.some((b) => b.includes("disabled"))).toBe(false);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>候选 2 · 选这张<\/button>/);
});

test("shows only the first persona image and the shot landmark's first image, with their position", () => {
  const html = render("kf_ready", { withRefs: true, landmark: "l1" });
  expect(html).toContain("本镜生成用到的参考图");
  expect(html).toContain("角色参考 · 小岛 · 第 1 张 / 共 3 张");
  expect(html).toContain("地标参考 · 地标 · 第 1 张 / 共 3 张");
  // The used-reference panel shows one landmark picture; the picker below it lists all of them as thumbnails.
  expect(html.match(/alt="地标 地标参考图"/g)).toHaveLength(1);
  expect(html).toMatch(/src="[^"]*a\.jpg[^"]*"[^>]*alt="地标 地标参考图"|alt="地标 地标参考图"[^>]*src="[^"]*a\.jpg/);
  expect(html.match(/front\.png/g)).toHaveLength(1);
  expect(html).not.toContain("side.png");
});

test("kf_review offers every landmark picture plus a no-landmark choice for regeneration", () => {
  const html = render("kf_ready", { withRefs: true, landmark: "l1" });
  expect(html).toContain("换地标参考图");
  for (const n of [1, 2, 3]) expect(html).toContain(`alt="地标 第 ${n} 张"`);
  expect(html).toContain("不使用地标图");
  expect(html).toContain("用所选参考图重生成");
});

test("a shot without a landmark has no picture picker", () => {
  expect(render("kf_ready", { withRefs: true, landmark: null })).not.toContain("换地标参考图");
});

test("a chosen outfit is named and its image is the one shown instead of the base image", () => {
  const html = render("kf_ready", { withRefs: true, landmark: "l1", outfitId: "o_1" });
  expect(html).toContain("角色参考 · 小岛 · 穿搭「秋日风衣」 · 第 1 张 / 共 1 张");
  expect(html).toContain("o_1.png");
  expect(html).not.toContain("front.png");
});

test("an empty shot with a landmark says the person reference was not used and shows only the landmark", () => {
  const html = render("kf_ready", { withRefs: true, landmark: "l1", empty: true });
  expect(html).toContain("本镜是空镜，没有使用角色参考图，只用了地标参考图。");
  expect(html).not.toContain("角色参考 · ");
  expect(html).not.toContain("front.png");
  expect(html).toContain("地标参考 · 地标");
});

test("a shot without a landmark says so instead of showing destination images", () => {
  const html = render("kf_ready", { withRefs: true, landmark: null });
  expect(html).toContain("本镜没有指定地标，只用了角色参考图。");
  expect(html).not.toContain("a.jpg");
});

test("a landmark that has no usable image is called out, not left blank", () => {
  const html = render("kf_ready", { withRefs: true, landmark: "gone" });
  expect(html).toContain("地标「gone」暂无参考图");
});

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
test("description save sends only the current prompt and version to PATCH and returns network failure", async () => {
  const calls: unknown[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) });
    throw new Error("offline");
  }) as unknown as typeof fetch;
  expect(await patchShot("e_save", 1, 7, { kf_prompt: "山顶晨光" })).toEqual({ ok: false, error: "network_error" });
  expect(calls).toEqual([{ url: "/api/episodes/e_save/shots/1", method: "PATCH", body: { row_version: 7, patch: { kf_prompt: "山顶晨光" } } }]);
});
