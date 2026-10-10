import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { fixture, shotFixture } from "../../server/routes/episode-test-fixtures";
import StageSteps, { episodeStages, currentEpisodeStage } from "./StageSteps";
import StagePlayback from "./StagePlayback";

const episode = fixture("e_playback", "u_1");
test("six stage navigation disables future stages and keeps true progress separate from selection", () => {
  const stages = episodeStages({ ...episode, status: "clipping" });
  expect(stages.filter(s => s.available).map(s => s.id)).toEqual(["project", "script", "keyframes", "clips"]);
  const html = renderToStaticMarkup(<StageSteps status="clipping" stages={stages} selectedStage="script" onSelect={() => {}} />);
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('data-stage="clips"');
  expect(html).toContain('disabled=""');
  expect(html).toContain("当前阶段");
});
test("direct and legacy workflows use five and six stages respectively", () => {
  expect(episodeStages({ ...episode, status: "done", video_source: "references" }).map(s => s.id)).toEqual(["project", "script", "clips", "compose", "final"]);
  expect(episodeStages({ ...episode, status: "done" }).every(s => s.available)).toBe(true);
});
test("unknown failure only exposes project and stages proven by saved data", () => {
  expect(episodeStages({ ...episode, status: "failed" }).filter(s => s.available).map(s => s.id)).toEqual(["project"]);
  const saved = { ...episode, status: "failed" as const, shots: [shotFixture(1, { clip: "clip/1.mp4" })] };
  expect(episodeStages(saved).filter(s => s.available).map(s => s.id)).toEqual(["project", "script", "clips"]);
  expect(episodeStages({ ...saved, grid_refs: ["grid.png"] }).find(s => s.id === "keyframes")?.available).toBe(true);
});
test("compose failure reaches clips, while a recomposition flag alone does not prove future stages", () => {
  expect(episodeStages({ ...episode, status: "failed" }, { stage: "compose", shot_no: null }).filter(s => s.available).map(s => s.id)).toEqual(["project", "script", "keyframes", "clips", "compose"]);
  expect(episodeStages({ ...episode, status: "script_review", final_needs_recompose: true }).filter(s => s.available).map(s => s.id)).toEqual(["project", "script"]);
});
test("read-only stages show saved data and empty states without write controls", () => {
  const saved = { ...episode, shots: [shotFixture(7, { candidates: ["kf/a.png"], kf_selected: "kf/b.png", caption: "你好", trim_start_s: 0.7, status: "approved" })] };
  for (const stage of ["project", "script", "keyframes", "clips", "compose"] as const) {
    const html = renderToStaticMarkup(<StagePlayback stage={stage} episode={saved} destination={null} persona={null} />);
    expect(html).not.toMatch(/保存设置|通过这一镜|继续 →|重生成|分享开关|<input|<textarea/);
    if (stage === "project") expect(html).toContain("角色快照缺失");
    if (stage === "script") { expect(html).toContain("缓慢走过"); expect(html).toContain("导出脚本 CSV"); }
    if (stage === "keyframes") { expect(html).toContain("kf/b.png"); expect(html).toContain("已选图"); }
    if (stage === "clips") { expect(html).toContain("0.70 秒"); expect(html).toContain("暂无已保存的视频"); expect(html).toContain("已通过"); }
  }
  expect(renderToStaticMarkup(<StagePlayback stage="script" episode={episode} destination={null} persona={null} />)).toContain("暂无已保存的脚本");
});
test("saved prior final is clearly identified when recomposition is needed", () => {
  const saved = { ...episode, final_needs_recompose: true, final: { version: 1, key: "final.mp4", duration_s: 8, width: 1080, height: 1920, fps: 30, size_bytes: 1, completed_at: "today" } };
  const html = renderToStaticMarkup(<StagePlayback stage="compose" episode={saved} destination={null} persona={null} />);
  expect(html).toContain("上一版成片 · 需要重新合成");
  expect(html).toContain("final.mp4");
});

test("failed current stage resolves to the operation view for both workflows", () => {
  expect(currentEpisodeStage({ ...episode, status: "failed" }, { stage: "compose", shot_no: null })).toBe("compose");
  expect(currentEpisodeStage({ ...episode, status: "failed", video_source: "references" }, { stage: "video", shot_no: 2 })).toBe("clips");
  expect(currentEpisodeStage({ ...episode, status: "failed" })).toBeNull();
});

test("re-edited completed work keeps previously saved stages available for read-only viewing", () => {
  const final = { version: 1, key: "final.mp4", duration_s: 8, width: 1080, height: 1920, fps: 30, size_bytes: 1, completed_at: "today" };
  const edited = { ...episode, status: "script_review" as const, final, final_needs_recompose: true };
  expect(episodeStages(edited).every(s => s.available)).toBe(true);
  const html = renderToStaticMarkup(<StageSteps status="script_review" stages={episodeStages(edited)} onSelect={() => {}} />);
  expect(html).toContain("已保存 · 可回看");
  expect(html).not.toContain("待开始");
  const partial = { ...episode, status: "script_review" as const, shots: [shotFixture(1, { candidates: ["kf.png"], clip: "clip.mp4" })] };
  expect(episodeStages(partial).filter(s => s.available).map(s => s.id)).toEqual(["project", "script", "keyframes", "clips"]);
});
