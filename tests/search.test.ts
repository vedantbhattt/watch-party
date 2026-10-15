import assert from "node:assert/strict";
import { test } from "node:test";
import { fuzzyMatches, normalizeSearchText } from "../lib/search";

test("search normalization ignores case, accents, and punctuation", () => {
  assert.equal(normalizeSearchText("  Amélie: A Film! "), "amelie a film");
});

test("fuzzy movie search tolerates common typos and searches genre/description fields", () => {
  assert.equal(fuzzyMatches("interstelar", "Interstellar", "Sci-Fi", "2014", "Love transcends dimensions"), true);
  assert.equal(fuzzyMatches("sci fi", "Interstellar", "Sci-Fi", "2014", "Space"), true);
  assert.equal(fuzzyMatches("batmn", "The Batman", "Action", "2022", "Gotham after dark"), true);
  assert.equal(fuzzyMatches("romance", "The Batman", "Action", "2022", "Gotham after dark"), false);
  assert.equal(fuzzyMatches("", "Any title"), true);
});
