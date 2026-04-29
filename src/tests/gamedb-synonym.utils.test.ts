import assert from "node:assert/strict";
import test from "node:test";
import { parseSynonymQuickAddTerms } from "../commands/gamedb-synonym.utils.js";

test("parseSynonymQuickAddTerms parses all supported separators and deduplicates by normalized term", () => {
  const terms = parseSynonymQuickAddTerms(
    "GTA",
    "Grand Theft Auto",
    "gta, Grand Theft Auto | gta-v; GTA V\ngta v\n\n",
  );

  assert.deepEqual(terms, ["GTA", "Grand Theft Auto", "gta-v"]);
});

test("parseSynonymQuickAddTerms filters empty and non-alphanumeric terms", () => {
  const terms = parseSynonymQuickAddTerms("!!!", "???", " , ; |\n");
  assert.deepEqual(terms, []);
});
