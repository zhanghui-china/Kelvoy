import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { fixture, shotFixture } from "../../server/routes/episode-test-fixtures";
import { patchShot } from "../api/client";
import { EpisodeDetailContent } from "../pages/EpisodeDetailPage";
import type { EpisodeMutation } from "./useEpisodeMutation";

function render(status: "failed" | "kf_selected" | "kf_ready" | "approved", options: {
  pending?: boolean; busy?: boolean; scripting?: boolean; generating?: boolean;
  candidates?: string[]; selected?: string;
} = {}) {
  const episode = { ...fixture("e_save", "owner"), status: options.generating ? "keyframing" as const : "kf_review" as const,
    script_pending_task_id: options.scripting ? "task" : undefined,
    shots: [shotFixture(1, { status, kf_prompt: "山顶晨光",
      candidates: options.candidates ?? [], kf_selected: options.selected ?? null })] };
  const mutation = { pending: !!options.pending, error: null, clearError() {}, async run() { return null; } } as EpisodeMutation;
  return renderToStaticMarkup(<StaticRouter location="/episodes/e_save">
    <EpisodeDetailContent episode={episode} destination={null} persona={null} mutation={mutation} storyboardBusy={options.busy} />
  </StaticRouter>);
}

test.each(["failed", "kf_selected", "kf_ready", "approved"] as const)("%s allows saving the current description independent of regeneration", (status) => {
  const html = render(status);
  const save = html.match(/<button[^>]*>保存画面描述<\/button>/)?.[0];
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
  for (const label of ["修改画面描述", "保存画面描述"]) {
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
