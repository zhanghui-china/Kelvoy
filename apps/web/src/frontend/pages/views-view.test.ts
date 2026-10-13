import { expect, test } from "bun:test";
import type { ViewsJobView } from "../../shared/views-job";
import { outfitPickState, suggestedOutfitId } from "./outfit-helpers";
import { pickJobForTarget, viewsFailureReason, viewsProgressText } from "./views-view";

const job = (extra: Partial<ViewsJobView>): ViewsJobView => ({
  job_id: "j", persona_id: "c_1", outfit_id: null, status: "pending", attempt: 1, error: null,
  created_at: "", updated_at: "", ...extra,
});

test("pickJobForTarget picks the active job for pending and the latest failed job for failed", () => {
  const jobs = [job({ job_id: "a", outfit_id: "o1", status: "processing" }), job({ job_id: "b", status: "failed", error: "x" }),
    job({ job_id: "c", status: "succeeded" })];
  expect(pickJobForTarget(jobs, "o1", "pending")?.job_id).toBe("a");
  expect(pickJobForTarget(jobs, null, "failed")?.job_id).toBe("b");
  expect(pickJobForTarget(jobs, null, "pending")).toBeNull();
  expect(pickJobForTarget(jobs, null, "ready")).toBeNull();
});

test("progress and failure text", () => {
  expect(viewsProgressText(job({ status: "pending" }))).toContain("排队中");
  expect(viewsProgressText(job({ status: "processing", attempt: 2 }))).toContain("第 2 次尝试");
  expect(viewsProgressText(null)).toContain("生成中");
  expect(viewsFailureReason(job({ status: "failed", error: "显存不足" }))).toBe("显存不足");
  expect(viewsFailureReason(null)).toContain("退回");
});

test("outfitPickState and suggestion skip outfits that are not selectable", () => {
  const base = { desc: "", seasons: ["秋"], refs: [] as string[] };
  const pending = { ...base, outfit_id: "p", name: "p", source: "s", views_status: "pending" as const };
  const legacy = { ...base, outfit_id: "l", name: "l", refs: ["r"] };
  expect(outfitPickState(pending)).toEqual({ selectable: false, note: "三视图生成中" });
  expect(outfitPickState(legacy)).toEqual({ selectable: true, note: "未生成三视图" });
  expect(suggestedOutfitId([pending, legacy], "秋")).toBe("l");
  expect(suggestedOutfitId([pending], "秋")).toBe("");
});
