import { describe, expect, test } from "bun:test";
import type { ShotStatus } from "../schema";
import { isLegalShotStatusChange, transitionShot } from "./shot";

describe("transitionShot: legal transitions", () => {
  test("draft --start_keyframe--> generating_kf", () => {
    expect(transitionShot("draft", { type: "start_keyframe" })).toBe("generating_kf");
  });

  test("generating_kf --keyframe_ready--> kf_ready", () => {
    expect(transitionShot("generating_kf", { type: "keyframe_ready" })).toBe("kf_ready");
  });

  test("kf_ready --select_keyframe--> kf_selected", () => {
    expect(transitionShot("kf_ready", { type: "select_keyframe" })).toBe("kf_selected");
  });

  test("kf_selected --start_clip--> generating_clip", () => {
    expect(transitionShot("kf_selected", { type: "start_clip" })).toBe("generating_clip");
  });

  test("generating_clip --clip_ready--> clip_ready", () => {
    expect(transitionShot("generating_clip", { type: "clip_ready" })).toBe("clip_ready");
  });

  test("clip_ready --approve--> approved", () => {
    expect(transitionShot("clip_ready", { type: "approve" })).toBe("approved");
  });

  const regenSources: ShotStatus[] = ["kf_ready", "clip_ready", "approved"];
  for (const state of regenSources) {
    test(`${state} --request_regen--> rejected`, () => {
      expect(transitionShot(state, { type: "request_regen" })).toBe("rejected");
    });
  }

  test("generating_kf --fail--> failed", () => {
    expect(transitionShot("generating_kf", { type: "fail" })).toBe("failed");
  });

  test("generating_clip --fail--> failed", () => {
    expect(transitionShot("generating_clip", { type: "fail" })).toBe("failed");
  });

  test("rejected --retry(generating_kf)--> generating_kf", () => {
    expect(transitionShot("rejected", { type: "retry", into: "generating_kf" })).toBe(
      "generating_kf",
    );
  });

  test("rejected --retry(generating_clip)--> generating_clip", () => {
    expect(transitionShot("rejected", { type: "retry", into: "generating_clip" })).toBe(
      "generating_clip",
    );
  });

  test("failed --retry(generating_kf)--> generating_kf", () => {
    expect(transitionShot("failed", { type: "retry", into: "generating_kf" })).toBe(
      "generating_kf",
    );
  });
});

describe("transitionShot: illegal transitions", () => {
  test("draft --keyframe_ready--> throws", () => {
    expect(() => transitionShot("draft", { type: "keyframe_ready" })).toThrow();
  });

  test("kf_ready --start_keyframe--> throws", () => {
    expect(() => transitionShot("kf_ready", { type: "start_keyframe" })).toThrow();
  });

  test("draft --request_regen--> throws (not a regen source state)", () => {
    expect(() => transitionShot("draft", { type: "request_regen" })).toThrow();
  });

  test("generating_kf --request_regen--> throws (not a regen source state)", () => {
    expect(() => transitionShot("generating_kf", { type: "request_regen" })).toThrow();
  });

  test("draft --fail--> throws (not a generating state)", () => {
    expect(() => transitionShot("draft", { type: "fail" })).toThrow();
  });

  test("approved --approve--> throws (must come from clip_ready)", () => {
    expect(() => transitionShot("approved", { type: "approve" })).toThrow();
  });

  test("draft --retry--> throws (only rejected/failed can retry)", () => {
    expect(() => transitionShot("draft", { type: "retry", into: "generating_kf" })).toThrow();
  });
});

describe("isLegalShotStatusChange", () => {
  test("accepts draft -> generating_kf", () => {
    expect(isLegalShotStatusChange("draft", "generating_kf")).toBe(true);
  });

  test("accepts approved -> rejected (坏镜 report after approval)", () => {
    expect(isLegalShotStatusChange("approved", "rejected")).toBe(true);
  });

  test("accepts rejected -> generating_clip (retry)", () => {
    expect(isLegalShotStatusChange("rejected", "generating_clip")).toBe(true);
  });

  test("rejects skipping straight from draft to approved", () => {
    expect(isLegalShotStatusChange("draft", "approved")).toBe(false);
  });

  test("rejects request_regen from draft", () => {
    expect(isLegalShotStatusChange("draft", "rejected")).toBe(false);
  });
});
