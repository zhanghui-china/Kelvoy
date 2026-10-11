import { describe, expect, test } from "bun:test";
import { removeNegativeConstraints } from "./h3-prompt-format";

const FORBIDDEN = /\b(?:vocals?|voices?|dialogue)\b/i;

describe("removeNegativeConstraints", () => {
  test.each([
    "A quiet street at dawn with no distinct sound effects or vocal sounds.",
    "A quiet street at dawn with no prominent sound effects or human vocal sounds.",
    "A quiet street at dawn, no dialogue, footsteps, or human voices.",
  ])("strips whole negation clause: %s", text => {
    expect(removeNegativeConstraints(text)).not.toMatch(FORBIDDEN);
  });

  test("keeps affirmative sentences", () => {
    expect(removeNegativeConstraints("She says hello.")).toBe("She says hello.");
  });

  test("stops at period", () => {
    expect(removeNegativeConstraints("No face. She says hello.")).toContain("says");
  });

  test("stops at semicolon", () => {
    expect(removeNegativeConstraints("No face; she says hello.")).toContain("says");
  });

  test("stops at newline", () => {
    expect(removeNegativeConstraints("No face\nShe says hello")).toContain("says");
  });

  test("stops at ', but '", () => {
    expect(removeNegativeConstraints("no dialogue, but she says hello")).toContain("says");
  });

  test("caps a clause at 12 words", () => {
    const out = removeNegativeConstraints("no a b c d e f g h i j k l m n says hello");
    expect(out).toContain("says");
    expect(out).not.toMatch(/\bl\b/);
  });

  test("still strips previously supported forms", () => {
    expect(removeNegativeConstraints("no face, no eating, no cuts")).not.toMatch(/face|eating|cuts/);
    expect(removeNegativeConstraints("without dialogue or narration")).not.toMatch(/dialogue|narration/);
    expect(removeNegativeConstraints("no spoken dialogue")).not.toMatch(/spoken|dialogue/);
  });
});
