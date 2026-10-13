import { expect, test } from "bun:test";
import { DESTINATION_TYPE_LABELS } from "./labels";
import { BEST_TIME_SUGGESTIONS, appendBestTime } from "./destination-hints";

test("every destination type has a few distinct, short time suggestions", () => {
  for (const type of Object.keys(DESTINATION_TYPE_LABELS)) {
    const suggestions = BEST_TIME_SUGGESTIONS[type as keyof typeof BEST_TIME_SUGGESTIONS];
    expect(suggestions.length).toBeGreaterThanOrEqual(3);
    expect(new Set(suggestions).size).toBe(suggestions.length);
    for (const suggestion of suggestions) expect(suggestion.length).toBeLessThanOrEqual(20);
  }
});

test("appending a suggestion never overwrites or duplicates what the user wrote", () => {
  expect(appendBestTime("", "清晨日出前后")).toBe("清晨日出前后");
  expect(appendBestTime("   ", "清晨日出前后")).toBe("清晨日出前后");
  expect(appendBestTime("山门正对", "上午顺光")).toBe("山门正对；上午顺光");
  expect(appendBestTime("山门正对，上午顺光", "上午顺光")).toBe("山门正对，上午顺光");
  const full = "a".repeat(4000);
  expect(appendBestTime(full, "上午顺光")).toBe(full);
});
