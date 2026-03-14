import assert from "node:assert/strict";
import test from "node:test";
import Game from "../classes/Game.js";
import { buildDeletionComponents } from "../functions/NominationAdminHelpers.js";
import { buildNominationListPayload } from "../functions/NominationListComponents.js";

test("nomination delete admin view serializes with shared nomination list UI", async () => {
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
      [
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
      ],
      false,
    );
    const deleteButtons = buildDeletionComponents("nr-gotm", 140, [
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
    ], "admin");

    assert.equal(payload.files.length, 0);
    for (const component of [...payload.components, ...deleteButtons]) {
      assert.doesNotThrow(() => component.toJSON());
    }
  } finally {
    (Game.getGameById as unknown) = originalGetGameById;
  }
});
