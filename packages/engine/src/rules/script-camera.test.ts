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

  test("push contradicted by camera lift (production case e_0a0d9f4d shot 3)", () => {
    const v = cameraViolations(shot("push", "镜头缓慢向上抬升，展现整条街区灯火与水面倒影的全貌"));
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain("镜头升降");
  });

  test("camera lift is classed as pan, so a pan shot is consistent", () => {
    expect(cameraViolations(shot("pan", "镜头平稳向上升起，俯瞰整条街区"))).toEqual([]);
    expect(cameraViolations(shot("pan", "镜头缓缓下降，贴近水面"))).toEqual([]);
  });

  test("scene objects rising are not mistaken for camera lift", () => {
    expect(cameraViolations(shot("push", "灯火逐一升起，镜头缓慢推进"))).toEqual([]);
    expect(cameraViolations(shot("push", "镜头对准缓缓升起的月亮，缓慢推进"))).toEqual([]);
    expect(cameraViolations(shot("static", "炊烟向上升起，固定镜头"))).toEqual([]);
  });
});
