import assert from "node:assert/strict";
import test from "node:test";
import Gotm from "../classes/Gotm.js";
import NrGotm from "../classes/NrGotm.js";
import { buildRoundHistoryModal } from "../commands/round-history.command.js";
import {
  buildSuggestionCreateModal,
  buildSuggestionReviewDecisionModal,
} from "../commands/suggestion.command.js";

test("round history modal serializes label-based discord.js components", () => {
  const originalGotmAll = Gotm.all;
  const originalNrGotmAll = NrGotm.all;
  (Gotm.all as unknown) = () => [];
  (NrGotm.all as unknown) = () => [];

  try {
    const modal = buildRoundHistoryModal("u123456789012345678_c0_tabc123");
    const json = modal.toJSON();

    assert.doesNotThrow(() => modal.toJSON());
    assert.equal(JSON.stringify(json).includes("\"type\":21"), true);
  } finally {
    (Gotm.all as unknown) = originalGotmAll;
    (NrGotm.all as unknown) = originalNrGotmAll;
  }
});

test("suggestion modals serialize checkbox and radio label components", () => {
  const createModal = buildSuggestionCreateModal();
  const reviewModal = buildSuggestionReviewDecisionModal(
    "suggestion-review-decision:123456789012345678:42",
    "Suggestion: #42 - Test\n\nDetails:\nTry the new modal.",
  );

  assert.doesNotThrow(() => createModal.toJSON());
  assert.doesNotThrow(() => reviewModal.toJSON());
  assert.equal(JSON.stringify(createModal.toJSON()).includes("\"type\":22"), true);
  assert.equal(JSON.stringify(reviewModal.toJSON()).includes("\"type\":21"), true);
});
