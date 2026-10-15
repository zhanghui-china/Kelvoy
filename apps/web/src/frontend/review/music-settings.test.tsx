import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { fixture } from "../../server/routes/episode-test-fixtures";
import { musicSettingsPatch } from "./MusicSettings";
import { MUSIC_CATALOG } from "@kelvoy/engine";
import ComposeSetup from "./ComposeSetup";
import DoneView from "./DoneView";
import ProgressView from "./ProgressView";
import { StaticRouter } from "react-router-dom/server";
import type { EpisodeMutation } from "./useEpisodeMutation";

const mutation: EpisodeMutation = { pending: false, error: null, clearError: () => {}, run: async () => null };
const base = fixture("e_music", "u_music");
const render = (component: React.ReactNode) => renderToStaticMarkup(<StaticRouter location="/episodes/e_music">{component}</StaticRouter>);

test("delivery no longer hosts settings; it sends the user back to the owning stages", () => {
  const html = render(<DoneView episode={{ ...base, status: "done" }} mutation={mutation} />);
  expect(html).not.toContain("启用配乐");
  expect(html).not.toContain("烧录每镜字幕");
  expect(html).not.toContain("重生成关键帧");
  expect(html).toContain("回到配乐合成");
  expect(html).toContain("回到视频片段");
});

test("compose with a prior final offers re-compose and a way back to clips", () => {
  const html = render(<ComposeSetup episode={{ ...base, final: { key: "final/a.mp4", duration_s: 30, width: 1080, height: 1920,
    fps: 30, size_bytes: 1, completed_at: "2026-10-15T00:00:00Z" } as never }} mutation={mutation} />);
  expect(html).toContain("重新合成");
  expect(html).toContain("回到视频片段");
});

test.each([undefined, true, false])("compose uses the music switch with enabled=%s", enabled => {
  const episode = { ...base, music: { ...base.music, enabled, file: "music/old.mp3" } };
  for (const component of [<ComposeSetup episode={episode} mutation={mutation} />]) {
    const html = render(component);
    expect(html).toContain("启用配乐");
    expect(html).toContain('aria-label="启用配乐"');
    expect(html).toContain(enabled === false ? 'aria-label="配乐曲目" disabled=""' : 'aria-label="配乐曲目"');
    expect(html).toContain('value="music/old.mp3" selected=""');
    if (enabled !== false) expect(html).toContain('aria-label="启用配乐" checked=""');
    else expect(html).not.toContain('aria-label="启用配乐" checked=""');
  }
});

test("original audio is a switch separate from music and saves independently", () => {
  for (const on of [undefined, true]) {
    const episode = { ...base, render: { ...base.render, original_audio_enabled: on } };
    const html = render(<ComposeSetup episode={episode} mutation={mutation} />);
    expect(html).toContain('aria-label="保留视频原声"');
    if (on) expect(html).toContain('aria-label="保留视频原声" checked=""');
    else expect(html).not.toContain('aria-label="保留视频原声" checked=""');
  }
  const off = { ...base, music: { ...base.music, enabled: false }, render: { ...base.render, original_audio_enabled: true } };
  expect(render(<ComposeSetup episode={off} mutation={mutation} />)).toContain("成片只保留视频原声，不含配乐");
});

test("compose failure offers settings and a single failed-task retry while preserving a concrete reason", () => {
  const episode = { ...base, status: "failed" as const, failure_reason: "所选配乐素材不可用，请更换配乐或联系管理员" };
  const html = render(<ProgressView episode={episode} mutation={mutation} failedTask={{ stage: "compose", shot_no: null }} />);
  expect(html).toContain("调整合成设置");
  expect(html).toContain("启用配乐");
  expect(html).toContain("保存设置");
  expect(html).toContain(episode.failure_reason);
  expect(html.match(/>重新执行失败任务<\/button>/g)).toHaveLength(1);
  expect(html).not.toContain("开始合成</button>");
});


test("switch-only save preserves track metadata, and selecting automatic music preserves disabled state", () => {
  const current = { file: "music/old.mp3", bpm: 77, license: "legacy", enabled: true };
  expect(musicSettingsPatch(current, false, current.file)).toEqual({ ...current, enabled: false });
  expect(musicSettingsPatch(current, false, "")).toEqual({ file: "", bpm: 0, license: "", enabled: false });
  const track = MUSIC_CATALOG[0]!;
  expect(musicSettingsPatch(current, false, track.file)).toEqual({ file: track.file, bpm: track.bpm, license: track.license, enabled: false });
});

test("pending compose retry disables settings and submit", () => {
  const html = render(<ComposeSetup episode={base} mutation={{ ...mutation, pending: true }} retryFailed />);
  expect(html).toContain('aria-label="启用配乐" disabled=""');
  expect(html).toContain('aria-label="配乐曲目" disabled=""');
  expect(html).toContain('disabled="">提交中…</button>');
});
