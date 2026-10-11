import { CompositionConstraintError } from "@kelvoy/engine";
import type { CompositionTaskDiagnostic } from "@kelvoy/store";

export type CompositionAsset = "clip" | "music" | "intro" | "outro" | "lut" | "font";
const assetNames: Record<CompositionAsset, string> = {
  clip:"片段", music:"配乐文件", intro:"片头", outro:"片尾", lut:"LUT 文件", font:"字体文件",
};

type Code = CompositionTaskDiagnostic["code"];
const messages: Record<Code, string> = {
  asset_missing: "合成所需素材不可用，请联系管理员。",
  media_invalid: "合成素材无法读取，请更换素材或联系管理员。",
  dependency_missing: "合成服务缺少必要依赖，请联系管理员。",
  duration_constraint: "素材时长不满足当前剪辑要求，请调整选段后重试。",
  encoding_failed: "视频编码失败，已有素材和成片已保留，请重试或联系管理员。",
};

/** Carries only safe messages; ffmpeg commands and stderr never reach task diagnostics. */
export class CompositionError extends Error {
  constructor(public code: Code, asset?: { kind: CompositionAsset; shotNo?: number }, public exitCode?: number) {
    const name = asset && Object.hasOwn(assetNames, asset.kind) ? assetNames[asset.kind] : null;
    const shot = asset?.kind === "clip" && Number.isSafeInteger(asset.shotNo) && asset.shotNo! > 0
      ? `第 ${asset.shotNo} 镜的片段` : name;
    super(code === "asset_missing" && name
      ? asset!.kind === "music" ? "所选配乐素材不可用，请更换配乐或联系管理员。"
        : `合成缺少${shot}，请联系管理员。`
      : messages[code]);
  }
}

export function compositionFailure(error: unknown, elapsedSeconds: number): {
  diagnostic: CompositionTaskDiagnostic; retryable: boolean; exitCode?: number;
} {
  const code = error instanceof CompositionConstraintError ? "duration_constraint"
    : error instanceof CompositionError ? error.code : "encoding_failed";
  return { diagnostic: { stage: "compose", code,
    message: error instanceof CompositionError || error instanceof CompositionConstraintError ? error.message : messages[code],
    elapsed_seconds: Math.max(0, elapsedSeconds) },
    retryable: code === "encoding_failed",
    exitCode: error instanceof CompositionError ? error.exitCode : undefined };
}

export function encodingFailure(stderr: string, exitCode: number): CompositionError {
  if (/invalid data found|could not find codec parameters|error opening input|moov atom not found|invalid input|unable to parse|matches no streams|does not contain any stream/i.test(stderr)) {
    return new CompositionError("media_invalid", undefined, exitCode);
  }
  if (/no such filter|unknown encoder|encoder .* not found|error initializing.*encoder.*not found/i.test(stderr)) {
    return new CompositionError("dependency_missing", undefined, exitCode);
  }
  return new CompositionError("encoding_failed", undefined, exitCode);
}
