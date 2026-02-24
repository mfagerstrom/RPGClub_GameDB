import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";
import type { IUserGameCollectionEntry } from "../classes/UserGameCollection.js";
import UserGameCollection from "../classes/UserGameCollection.js";
import Game from "../classes/Game.js";
import { buildCollectionListResponseForTests } from "../commands/collection.command.js";

function flattenErrorMessages(error: unknown, depth: number = 0): string[] {
  if (!error || depth > 4) return [];
  const anyError = error as any;
  const messages: string[] = [];
  const baseMessage = String(anyError?.message ?? "").trim();
  if (baseMessage) messages.push(baseMessage);

  const nested = [
    ...(Array.isArray(anyError?.errors) ? anyError.errors : []),
    ...(Array.isArray(anyError?.issues) ? anyError.issues : []),
  ];
  for (const item of nested) {
    messages.push(...flattenErrorMessages(item, depth + 1));
  }

  if (anyError?.cause) {
    messages.push(...flattenErrorMessages(anyError.cause, depth + 1));
  }

  return [...new Set(messages)];
}

function makeEntry(params: {
  entryId: number;
  gameId: number;
  title: string;
  platformName: string | null;
  ownershipType: "Digital" | "Physical" | "Subscription" | "Other";
  note: string | null;
}): IUserGameCollectionEntry {
  return {
    entryId: params.entryId,
    userId: "user-1",
    gameId: params.gameId,
    title: params.title,
    platformId: params.platformName ? params.entryId : null,
    platformName: params.platformName,
    platformAbbreviation: params.platformName ? "PLT" : null,
    ownershipType: params.ownershipType,
    note: params.note,
    isShared: true,
    createdAt: new Date("2026-02-20T12:00:00.000Z"),
    updatedAt: new Date("2026-02-20T12:00:00.000Z"),
  };
}

test("collection list v2 payload serializes on paged filtered edge-case entries", async () => {
  const entries: IUserGameCollectionEntry[] = [
    makeEntry({
      entryId: 1,
      gameId: 501,
      title: "A".repeat(180),
      platformName: "Nintendo Switch",
      ownershipType: "Digital",
      note: "N".repeat(500),
    }),
    makeEntry({
      entryId: 2,
      gameId: 502,
      title: "Title with markdown *and* `code` and [links](https://example.com)",
      platformName: null,
      ownershipType: "Physical",
      note: null,
    }),
    ...Array.from({ length: 10 }, (_, index) =>
      makeEntry({
        entryId: index + 3,
        gameId: 600 + index,
        title: `Paged title ${index + 1}`,
        platformName: index % 2 === 0 ? "PC (Steam)" : "PlayStation 5",
        ownershipType: index % 3 === 0 ? "Subscription" : "Other",
        note: index % 2 === 0 ? "short note" : null,
      })),
  ];

  const originalSearchEntries = UserGameCollection.searchEntries;
  const originalGetGameById = Game.getGameById;
  const searchEntriesMock = async () => entries;
  const getGameByIdMock = async () => null;

  (UserGameCollection.searchEntries as unknown) = searchEntriesMock;
  (Game.getGameById as unknown) = getGameByIdMock;

  try {
    const response = await buildCollectionListResponseForTests({
      viewerUserId: "viewer-1",
      targetUserId: "viewer-1",
      memberLabel: "Viewer",
      title: "A",
      platform: "switch",
      platformId: undefined,
      platformLabel: "switch",
      ownershipType: "Digital",
      page: 1,
      isEphemeral: true,
    });

    assert.equal(response.content, undefined);
    assert.ok(response.components.length >= 2);
    for (const [index, component] of response.components.entries()) {
      try {
        (component as any).toJSON();
      } catch (error) {
        const messages = flattenErrorMessages(error);
        assert.fail(
          `Component at index ${index} failed toJSON(): ${messages.join(" | ")}\n` +
          inspect(error, { depth: 6, breakLength: 140 }),
        );
      }
    }
  } finally {
    (UserGameCollection.searchEntries as unknown) = originalSearchEntries;
    (Game.getGameById as unknown) = originalGetGameById;
  }
});
