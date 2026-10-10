import { expect, test } from "bun:test";
import { StaticRouter } from "react-router-dom/server";
import { renderToStaticMarkup } from "react-dom/server";
import { fixture, shotFixture } from "../../server/routes/episode-test-fixtures";
import ComposeSetup from "./ComposeSetup";
import DoneView from "./DoneView";
import StoryboardShotForm from "./StoryboardShotForm";
import { emptyShot } from "./storyboard-model";
import type { EpisodeMutation } from "./useEpisodeMutation";
const mutation = { pending: false, error: null, clearError() {}, async run() { return null; } } as EpisodeMutation;
const episode = { ...fixture("e_subtitles_ui", "u"), status: "done" as const, shots: [shotFixture(1, { caption: "中文" }), shotFixture(2, { caption: "  " })] };
for (const View of [ComposeSetup, DoneView]) {
  test(`${View.name} shows legacy subtitles enabled by default and explains empty shots`, () => {
    const html = renderToStaticMarkup(<StaticRouter location="/"><View episode={episode} mutation={mutation} /></StaticRouter>);
    expect(html).toContain("烧录每镜字幕");
    expect(html).toContain('checked=""');
    expect(html).toContain("已填写字幕 1 / 2 镜");
    expect(html).toContain("空字幕不显示");
    const off = renderToStaticMarkup(<StaticRouter location="/"><View episode={{ ...episode, render: { ...episode.render, subtitles_enabled: false } }} mutation={mutation} /></StaticRouter>);
    expect(off).toContain("本次成片不显示每镜字幕");
  });
}
test("caption save explains when the final will update", () => {
  const html = renderToStaticMarkup(<StoryboardShotForm episode={episode} destination={null} initial={emptyShot("")} mutation={mutation} locked={false} captionOnly onSave={async () => true} onCancel={() => {}} />);
  expect(html).toContain("保存字幕");
  expect(html).toContain("保存后需合成／重新合成才会更新成片");
});
