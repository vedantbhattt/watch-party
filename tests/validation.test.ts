import assert from "node:assert/strict";
import { test } from "node:test";
import { clampPosition, getYouTubeVideoId, isValidRoomCode, normalizeDisplayName, normalizeMediaUrl, normalizeRoomCode } from "../lib/validation";

test("room codes are normalized and validated consistently", () => {
  assert.equal(normalizeRoomCode("  ab12cd "), "AB12CD");
  assert.equal(isValidRoomCode("AB12CD"), true);
  assert.equal(isValidRoomCode("ABC"), false);
  assert.equal(isValidRoomCode("AB 2CD"), false);
});

test("display names are trimmed, bounded, and have a safe fallback", () => {
  assert.equal(normalizeDisplayName("  Alice  "), "Alice");
  assert.equal(normalizeDisplayName("\n\t ", "Guest"), "Guest");
  assert.equal(normalizeDisplayName("A".repeat(40)).length, 24);
});

test("media validation accepts safe HTTP(S) URLs and rejects unsafe schemes or credentials", () => {
  assert.equal(normalizeMediaUrl(""), "");
  assert.equal(normalizeMediaUrl("https://example.com/video.mp4"), "https://example.com/video.mp4");
  assert.equal(normalizeMediaUrl("https://youtu.be/dQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(normalizeMediaUrl("https://youtube.com/shorts/dQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(normalizeMediaUrl("https://youtube.com/watch?v=not-a-valid-id"), null);
  assert.equal(normalizeMediaUrl("javascript:alert(1)"), null);
  assert.equal(normalizeMediaUrl("https://user:password@example.com/video.mp4"), null);
  assert.equal(normalizeMediaUrl("not a url"), null);
  assert.equal(normalizeMediaUrl("x".repeat(2049)), null);
});

test("YouTube IDs are extracted from watch, short, shorts, embed and live URLs", () => {
  const id = "dQw4w9WgXcQ";
  assert.equal(getYouTubeVideoId(`https://www.youtube.com/watch?v=${id}&t=10`), id);
  assert.equal(getYouTubeVideoId(`https://youtu.be/${id}?si=abc`), id);
  assert.equal(getYouTubeVideoId(`https://youtube.com/shorts/${id}`), id);
  assert.equal(getYouTubeVideoId(`https://youtube.com/embed/${id}`), id);
  assert.equal(getYouTubeVideoId(`https://youtube.com/live/${id}`), id);
  assert.equal(getYouTubeVideoId("https://example.com/video.mp4"), null);
  assert.equal(getYouTubeVideoId("https://youtube.com/watch?v=not-a-valid-id"), null);
  assert.equal(getYouTubeVideoId("https://notyoutube.com/watch?v=dQw4w9WgXcQ"), null);
});

test("playback positions are finite and clamped to a supported range", () => {
  assert.equal(clampPosition(-10), 0);
  assert.equal(clampPosition(12.5), 12.5);
  assert.equal(clampPosition(100000), 86400);
  assert.equal(clampPosition("NaN"), null);
});
