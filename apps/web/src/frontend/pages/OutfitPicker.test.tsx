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
  expect(out).toContain("添加穿搭");
});

test("outfit editor stops offering the add form at 6 outfits", () => {
  const six = Array.from({ length: 6 }, (_, i) => outfit(`o_${i}`, `套${i}`, []));
  const out = html(<PersonaOutfits persona={persona(six)} onChange={() => {}} />);
  expect(out).toContain("已达 6 套上限");
  expect(out).not.toContain("选择图片");
});
