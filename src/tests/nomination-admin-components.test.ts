import assert from "node:assert/strict";
import test from "node:test";
import Game from "../classes/Game.js";
import {
  buildDeletionSelectControls,
  parseDeletionReasonSessionRecord,
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

test("reason session parser accepts matching persisted session state", () => {
  const state = parseDeletionReasonSessionRecord({
    sessionId: "abc123",
    feature: "admin",
    flow: "nomination-delete-reason",
    ownerUserId: "user-1",
    guildId: "guild-1",
    channelId: "channel-1",
    stateJson: JSON.stringify({
      kind: "nr-gotm",
      round: 140,
      userId: "target-1",
      gameTitle: "Example Game",
    }),
    status: "submitted",
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-03-13T12:00:00.000Z"),
    updatedAt: new Date("2026-03-13T12:01:00.000Z"),
  }, "user-1");
  assert.deepEqual(state, {
    kind: "nr-gotm",
    round: 140,
    userId: "target-1",
    gameTitle: "Example Game",
  });
});
