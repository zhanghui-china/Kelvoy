import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Episode } from "@kelvoy/engine";
import StoryboardEditor from "./StoryboardEditor";
import StoryboardShotForm from "./StoryboardShotForm";
import { emptyShot } from "./storyboard-model";
import type { EpisodeMutation } from "./useEpisodeMutation";

const mutation = { pending: false, error: null, clearError() {}, async run() { return null; } } as EpisodeMutation;
function episode(shots: Episode["shots"] = []): Episode {
  return { episode_id: "e", mode: "per_shot", status: "done", shots, scenes: [], cut_policy: "fixed_1s" } as unknown as Episode;
}
test("empty completed storyboard permits first and last insertion without a minimum", () => {
  const html = renderToStaticMarkup(<StoryboardEditor episode={episode()} destination={null} mutation={mutation} />);
  expect(html).toContain("当前 0 镜");
  expect(html).toContain("支持保存空故事板");
  expect(html).toContain("在开头添加一镜");
  expect(html).toContain("在末尾添加一镜");
  expect(html).not.toContain('disabled=""');
});
test("active tasks explain generation lock and prevent structural mutation", () => {
  const html = renderToStaticMarkup(<StoryboardEditor episode={episode()} destination={null} mutation={mutation} busy />);
  expect(html).toContain("暂时锁定分镜修改");
  expect(html).toMatch(/disabled=""[^>]*>在开头添加一镜/);
  expect(html).toMatch(/disabled=""[^>]*>在末尾添加一镜/);
});
test("caption and visual editing remain separate and duration is not editable", () => {
  const common = { episode: episode(), destination: null, initial: emptyShot(""), mutation, locked: false,
    onSave: async () => true, onCancel() {} };
  const visual = renderToStaticMarkup(<StoryboardShotForm {...common} />);
  const caption = renderToStaticMarkup(<StoryboardShotForm {...common} captionOnly />);
  const insert = renderToStaticMarkup(<StoryboardShotForm {...common} afterId={null} price={7} />);
  expect(visual).toContain("画面动作（beat）");
  expect(visual).not.toContain("成片字幕");
  expect(caption).toContain("成片字幕");
  expect(caption).not.toContain("画面动作（beat）");
  expect(insert).toContain("默认场景（保存时创建）");
  expect(insert).toContain("消耗 7 积分");
  expect(insert).toContain("确认插入");
  expect(insert).not.toContain('type="number"');
});
test("edited storyboard keeps previous final clearly labeled", () => {
  const edited = { ...episode(), final_needs_recompose: true } as Episode;
  const html = renderToStaticMarkup(<StoryboardEditor episode={edited} destination={null} mutation={mutation} />);
  expect(html).toContain("下载与分享仍使用上一版");
});
test("person toggle always shows; suggested duration only for long_3_6", () => {
  const form = (cut_policy: string) => renderToStaticMarkup(<StoryboardShotForm episode={{ ...episode(), cut_policy } as Episode}
    destination={null} initial={{ ...emptyShot(""), person_visible: false }} mutation={mutation} locked={false} onSave={async () => true} onCancel={() => {}} />);
  const fixed = form("fixed_1s");
  expect(fixed).toContain("画面中有人物");
  expect(fixed).not.toContain("建议时长");
  expect(fixed).toMatch(/<input type="checkbox"(?![^>]*checked)/);
  const long = form("long_3_6");
  expect(long).toContain("建议时长（秒）");
  expect(long).toContain('min="3"');
  expect(long).toContain('max="6"');
});
