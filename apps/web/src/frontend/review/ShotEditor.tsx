import { type FormEvent, useState } from "react";
import type { Destination, Shot, ShotCamera, ShotPatch, ShotSize } from "@kelvoy/engine";
import { patchShot } from "../api/client";
import { SHOT_CAMERA_LABELS, SHOT_SIZE_LABELS } from "../labels";
import { describeWriteError } from "./errors";
import { MutationError } from "./ShotHeader";
import type { EpisodeMutation } from "./useEpisodeMutation";

const SIZES: ShotSize[] = ["wide", "medium", "close", "detail", "pov"];
const CAMERAS: ShotCamera[] = ["static", "pan", "push", "follow"];

/**
 * 审核 1 可改的镜头字段（PRD §4）。本地编辑态从打开编辑器那一刻的 shot
 * 初始化后就自己活着，3 秒一次的轮询不会把正在输入的内容冲掉——保存成功
 * 后由父组件关掉编辑器，下一次打开才重新读服务端值。
 */
export default function ShotEditor({
  episodeId,
  shot,
  destination,
  mutation,
  onSaved,
  onCancel,
}: {
  episodeId: string;
  shot: Shot;
  destination: Destination | null;
  mutation: EpisodeMutation;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [beat, setBeat] = useState(shot.beat);
  const [size, setSize] = useState<ShotSize>(shot.size);
  const [camera, setCamera] = useState<ShotCamera>(shot.camera);
  const [landmark, setLandmark] = useState<string>(shot.landmark ?? "");
  const [kfPrompt, setKfPrompt] = useState(shot.kf_prompt);
  const [motionPrompt, setMotionPrompt] = useState(shot.motion_prompt);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const patch: ShotPatch = {
      beat,
      size,
      camera,
      landmark: landmark === "" ? null : landmark,
      kf_prompt: kfPrompt,
      motion_prompt: motionPrompt,
    };
    const result = await mutation.run((rowVersion) => patchShot(episodeId, shot.no, rowVersion, patch));
    if (!result) return;
    if (!result.ok) {
      // 错误就地显示在这一镜上：mutation 是整页共用的，别的镜的失败不该
      // 出现在这里（mutation.error 还留给页面级操作用）。
      setError(describeWriteError(result));
      return;
    }
    onSaved();
  }

  return (
    <form className="k-desk-editor" onSubmit={handleSubmit}>
      <label className="k-field">
        动作 beat
        <input value={beat} onChange={(e) => setBeat(e.target.value)} required />
      </label>
      <div className="k-desk-editor-row">
        <label className="k-field">
          景别
          <select value={size} onChange={(e) => setSize(e.target.value as ShotSize)}>
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {SHOT_SIZE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="k-field">
          机位
          <select value={camera} onChange={(e) => setCamera(e.target.value as ShotCamera)}>
            {CAMERAS.map((cam) => (
              <option key={cam} value={cam}>
                {SHOT_CAMERA_LABELS[cam]}
              </option>
            ))}
          </select>
        </label>
        <label className="k-field">
          地标
          <select value={landmark} onChange={(e) => setLandmark(e.target.value)}>
            <option value="">无</option>
            {(destination?.landmarks ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="k-field">
        关键帧 prompt
        <textarea value={kfPrompt} onChange={(e) => setKfPrompt(e.target.value)} />
      </label>
      <label className="k-field">
        运动 prompt
        <textarea value={motionPrompt} onChange={(e) => setMotionPrompt(e.target.value)} />
      </label>
      <MutationError error={error} />
      <div className="k-desk-actions">
        <button type="submit" className="k-btn k-btn-primary" disabled={mutation.pending}>
          {mutation.pending ? "保存中…" : "保存这一镜"}
        </button>
        <button type="button" className="k-btn k-btn-secondary" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}
