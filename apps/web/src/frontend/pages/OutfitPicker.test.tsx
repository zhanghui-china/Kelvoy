import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import type { Persona } from "@kelvoy/engine";
import OutfitPicker from "./OutfitPicker";
import PersonaOutfits from "./PersonaOutfits";

const persona = (outfits?: Persona["outfits"], owner: string | null = "u_1"): Persona => ({
  persona_id: "c_1", owner_id: owner, version: 3, name: "小岛", desc: "", locked: [], default_outfit: "浅灰衬衫",
  refs: ["persona/c_1/base.png"], style: { lut: "x", title_style: "y" }, ...(outfits ? { outfits } : {}),
});
const outfit = (id: string, name: string, seasons: string[]) =>
  ({ outfit_id: id, name, desc: "", seasons, refs: [`persona/c_1/${id}.png`] });
const html = (node: React.ReactNode) => renderToStaticMarkup(<StaticRouter location="/">{node}</StaticRouter>);

test("default outfit is first; fitting outfits come next and are marked", () => {
  const out = html(<OutfitPicker persona={persona([outfit("o_s", "夏装", ["夏"]), outfit("o_a", "风衣", ["秋"])])}
    season="秋" value="o_a" onChange={() => {}} />);
  const names = [...out.matchAll(/<strong>([^<]*)<\/strong>/g)].map((m) => m[1]);
  expect(names).toEqual(["默认穿搭", "风衣 · 适合本季", "夏装"]);
  expect(out).toContain('aria-pressed="true"');
  expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
  expect(out).toContain("o_a.png");
});

test("an own persona without outfits links to the editor; an official one shows nothing", () => {
  expect(html(<OutfitPicker persona={persona()} season="秋" value="" onChange={() => {}} />))
    .toContain("/personas/c_1/edit");
  expect(html(<OutfitPicker persona={persona(undefined, null)} season="秋" value="" onChange={() => {}} />)).toBe("");
});

test("outfit editor lists outfits with counts and the add form", () => {
  const out = html(<PersonaOutfits persona={persona([outfit("o_a", "风衣", ["秋", "冬"])])} onChange={() => {}} />);
  expect(out).toContain("1 / 6");
  expect(out).toContain("风衣");
  expect(out).toContain("追加图片（1/3）");
  expect(out).toContain("选择全身照");
  expect(out).toContain("添加穿搭");
});

test("outfit editor stops offering the add form at 6 outfits", () => {
  const six = Array.from({ length: 6 }, (_, i) => outfit(`o_${i}`, `套${i}`, []));
  const out = html(<PersonaOutfits persona={persona(six)} onChange={() => {}} />);
  expect(out).toContain("已达 6 套上限");
  expect(out).not.toContain("选择全身照");
});

const sourceOutfit = (id: string, status?: "none" | "pending" | "ready" | "failed"): Persona["outfits"] extends (infer O)[] | undefined ? O : never => ({
  outfit_id: id, name: `套${id}`, desc: "", seasons: ["秋"], refs: [], source: `persona/c_1/${id}_src.png`,
  ...(status ? { views_status: status } : {}),
  ...(status === "ready" ? { views: { front: `persona/c_1/${id}_f.png`, side: "s", back: "b", sheet: "sh" },
    views_gen: { provider: "p", model: "m", version: "1", seed: 1 } } : {}),
});

test("picker disables source outfits whose three views are not ready, uses the front view as thumbnail", () => {
  const out = html(<OutfitPicker persona={persona([sourceOutfit("a", "ready"), sourceOutfit("b", "pending"),
    sourceOutfit("c", "failed"), sourceOutfit("d"), outfit("old", "老穿搭", [])])} season="" value="" onChange={() => {}} />);
  expect(out).toContain("a_f.png");
  expect(out.match(/disabled=""/g)).toHaveLength(3);
  expect(out).toContain("三视图生成中");
  expect(out).toContain("三视图生成失败");
  expect(out).toContain("三视图未生成");
  expect(out).toContain("未生成三视图");
});

test("outfit card shows source photo and generate button with estimated credits", () => {
  const out = html(<PersonaOutfits persona={persona([sourceOutfit("a")])} onChange={() => {}} />);
  expect(out).toContain("a_src.png");
  expect(out).toContain("生成三视图（预估 1 积分）");
  expect(out).not.toContain("追加图片");
});

test("outfit card in each views state", () => {
  const ready = html(<PersonaOutfits persona={persona([sourceOutfit("a", "ready")])} onChange={() => {}} />);
  expect(ready).toContain("a_f.png");
  expect(ready).toContain("重新生成");
  const pending = html(<PersonaOutfits persona={persona([sourceOutfit("a", "pending")])} onChange={() => {}} />);
  expect(pending).toContain("取消生成");
  expect(pending).toContain('aria-live="polite"');
  const failed = html(<PersonaOutfits persona={persona([sourceOutfit("a", "failed")])} onChange={() => {}} />);
  expect(failed).toContain("重试（预估 1 积分）");
  expect(failed).toContain('role="alert"');
  const legacy = html(<PersonaOutfits persona={persona([outfit("old", "老", [])])} onChange={() => {}} />);
  expect(legacy).toContain("旧式穿搭");
});
