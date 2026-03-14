import assert from "node:assert/strict";
import test from "node:test";
import Game from "../classes/Game.js";
import {
  buildDeletionReasonModalCustomId,
  buildDeletionSelectControls,
  parseDeletionReasonStateId,
} from "../functions/NominationAdminHelpers.js";
import { buildNominationListPayload } from "../functions/NominationListComponents.js";

const nominations = [
  {
    id: 1,
    roundNumber: 140,
    userId: "123456789012345678",
    gameTitle: "Example Game One",
    gamedbGameId: 41,
    nominatedAt: new Date("2026-03-13T12:00:00.000Z"),
    reason: "First reason.",
  },
  {
    id: 2,
    roundNumber: 140,
    userId: "223456789012345678",
    gameTitle: "Example Game Two",
    gamedbGameId: 42,
    nominatedAt: new Date("2026-03-13T12:05:00.000Z"),
    reason: "Second reason.",
  },
];

test("nomination delete admin view serializes with shared nomination list UI and delete select", async () => {
  const originalGetGameById = Game.getGameById;
  (Game.getGameById as unknown) = async () => null;

  try {
    const payload = await buildNominationListPayload(
      "NR-GOTM",
      "/nominate",
      {
        closesAt: new Date("2026-03-13T12:00:00.000Z"),
        nextVoteAt: new Date("2026-03-20T12:00:00.000Z"),
        targetRound: 140,
      },
      nominations,
      false,
      { includeDetailSelect: false },
    );
    const deleteSelect = buildDeletionSelectControls("nr-gotm", 140, nominations);

    assert.equal(payload.files.length, 0);
    const payloadJson = payload.components.map((component) => component.toJSON());
    assert.equal(
      JSON.stringify(payloadJson).includes("nom-details"),
      false,
    );
    for (const component of [...payload.components, ...deleteSelect]) {
      assert.doesNotThrow(() => component.toJSON());
    }
  } finally {
    (Game.getGameById as unknown) = originalGetGameById;
  }
});

test("reason modal custom id parses nomination target state", () => {
  const state = parseDeletionReasonStateId(
    buildDeletionReasonModalCustomId("nr-gotm", 140, "123456789012345678"),
  );
  assert.deepEqual(state, {
    kind: "nr-gotm",
    round: 140,
    userId: "123456789012345678",
    gameTitle: "",
  });
});
