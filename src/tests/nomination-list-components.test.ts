import assert from "node:assert/strict";
import test from "node:test";
import Game from "../classes/Game.js";
import { buildNominationListPayload } from "../functions/NominationListComponents.js";

test("nomination list payload serializes when nominations do not have thumbnails", async () => {
  const originalGetGameById = Game.getGameById;
  (Game.getGameById as unknown) = async () => null;

  try {
    const payload = await buildNominationListPayload(
      "GOTM",
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
          gameTitle: "Example Game",
          gamedbGameId: 42,
          nominatedAt: new Date("2026-03-13T12:00:00.000Z"),
          reason: "This should still render without an image.",
        },
      ],
      false,
    );

    assert.equal(payload.files.length, 0);
    assert.ok(payload.components.length >= 1);
    for (const component of payload.components) {
      assert.doesNotThrow(() => component.toJSON());
    }
  } finally {
    (Game.getGameById as unknown) = originalGetGameById;
  }
});

test("nomination list payload keeps reasons longer than old 250 character limit", async () => {
  const originalGetGameById = Game.getGameById;
  (Game.getGameById as unknown) = async () => null;

  try {
    const longReason = "This nomination note should remain visible. ".padEnd(1500, "x");
    const payload = await buildNominationListPayload(
      "GOTM",
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
          gameTitle: "Example Game",
          gamedbGameId: 42,
          nominatedAt: new Date("2026-03-13T12:00:00.000Z"),
          reason: longReason,
        },
      ],
      false,
    );

    const serialized = JSON.stringify(payload.components.map((component) => component.toJSON()));
    assert.equal(serialized.includes(longReason), true);
    assert.equal(serialized.includes(`${longReason.slice(0, 247)}...`), false);
  } finally {
    (Game.getGameById as unknown) = originalGetGameById;
  }
});
