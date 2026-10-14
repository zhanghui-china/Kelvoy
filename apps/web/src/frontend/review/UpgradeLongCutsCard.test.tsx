import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Episode } from "@kelvoy/engine";
import UpgradeLongCutsCard, { canUpgradeToLongCuts } from "./UpgradeLongCutsCard";
import type { EpisodeMutation } from "./useEpisodeMutation";

const mutation = { pending: false, error: null, clearError() {}, async run() { return null; } } as EpisodeMutation;
const episode = (cut_policy: string, count = 7, clip: string | null = "c.mp4") => ({ episode_id: "e", mode: "per_shot", cut_policy,
  shots: Array.from({ length: count }, (_, i) => ({ no: i + 1, clip })) }) as unknown as Episode;

test("upgrade is offered for legacy policies with all clips, never for long_3_6", () => {
  expect(canUpgradeToLongCuts(episode("fixed_1s"))).toBe(true);
  expect(canUpgradeToLongCuts(episode("beat_aligned"))).toBe(true);
  expect(canUpgradeToLongCuts(episode("long_3_6"))).toBe(false);
  expect(canUpgradeToLongCuts(episode("fixed_1s", 7, null))).toBe(false);
});
test("card defaults to a feasible duration and shows the allowed range", () => {
  const html = renderToStaticMarkup(<UpgradeLongCutsCard episode={episode("fixed_1s", 7)} mutation={mutation} title="t" hint="h" />);
  expect(html).toContain('value="28"');
  expect(html).toContain("可选 21–42 秒");
  expect(html).not.toMatch(/disabled=""[^>]*>升级为/);
});
test("too many shots clamp the default to the minimum feasible duration", () => {
  const html = renderToStaticMarkup(<UpgradeLongCutsCard episode={episode("fixed_1s", 28)} mutation={mutation} title="t" hint="h" />);
  expect(html).toContain('value="112"');
  expect(html).toContain("可选 84–168 秒");
});
