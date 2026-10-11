import { describe, expect, test } from "bun:test";
import type { Destination } from "../schema/destination";
import type { Shot } from "../schema/episode";
import { checkScriptRules } from "./script";

const destination = {
  destination_id: "d_test", version: 1, name: "测试景区", city: "无锡", type: "scenic_area",
  season_best: [], landmarks: [], route: [], food: [], transport: "", stay: "",
} as Destination;

const shot = (camera: Shot["camera"], motion_prompt: string, no = 3): Shot => ({
  no, scene: "s1", size: "wide", beat: "test", camera, landmark: null, kf_prompt: "",
  motion_prompt, duration_s: 4, candidates: [], kf_selected: null, clip: null,
  trim_start_s: null, status: "draft", regen_stage: null, bad_shot_reported: false, model: {},
});

const cameraViolations = (s: Shot) =>
  checkScriptRules([s], destination).filter((v) => v.rule === "camera_motion_consistency");

describe("camera_motion_consistency", () => {
  test("tilt-style 仰拍 counts as pan", () => {
    expect(cameraViolations(shot("pan", "镜头缓慢向上仰拍，完整展示大佛上半身"))).toEqual([]);
  });

  test("pan contradicted by push wording", () => {
    const v = cameraViolations(shot("pan", "镜头缓慢推进，聚焦蒸汽"));
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("camera_motion_consistency");
    expect(v[0]!.message).toContain("第 3 镜");
  });

  test("static contradicted by pan wording", () => {
    expect(cameraViolations(shot("static", "镜头缓慢向右平移"))).toHaveLength(1);
  });

  test("push contradicted by fixed camera", () => {
    expect(cameraViolations(shot("push", "固定镜头，人物转身"))).toHaveLength(1);
  });

  test("ambiguous motion (push and pan) is not judged", () => {
    expect(cameraViolations(shot("pan", "人物向右走，镜头缓慢推进并向左摇"))).toEqual([]);
  });

  test("no camera motion stated is not judged", () => {
    expect(cameraViolations(shot("pan", "人物微笑着看向远方"))).toEqual([]);
  });

  test("character motion is not mistaken for camera motion", () => {
    expect(cameraViolations(shot("static", "人物向右缓慢走过，镜头固定"))).toEqual([]);
  });
});
