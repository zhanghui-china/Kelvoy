import { expect, test } from "bun:test";
import { MUSIC_CATALOG, musicLibraryProvider } from "./music-library";

test("selectTrack matches brief.tone against the catalog's tone words", async () => {
  const track = await musicLibraryProvider.selectTrack({ tone: "松弛治愈的秋日" });
  expect(track.file).toBe("music/calm_morning.mp3");
  expect(track.bpm).toBe(84);
  expect(track.license).not.toBe("");
});

test("selectTrack falls back to the first entry when no tone matches", async () => {
  const track = await musicLibraryProvider.selectTrack({ tone: "无法匹配的语气" });
  expect(track.file).toBe(MUSIC_CATALOG[0]!.file);
});

test("selectTrack honours an explicit bpm by picking the nearest track", async () => {
  const track = await musicLibraryProvider.selectTrack({ bpm: 125 });
  expect(track.bpm).toBe(128);
});
