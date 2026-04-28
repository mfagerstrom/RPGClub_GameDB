import assert from "node:assert/strict";
import test from "node:test";
import {
  applyEditTargetToState,
  buildNominationPreviewLine,
  executeRoundSetupCommit,
  isCancelInput,
  mapSelectedNominationsToRoundPayloads,
  normalizeOrder,
  resolveResumeChoice,
  resolveReviewDecision,
  splitEligibleNominations,
  toNominationOptionMap,
} from "../commands/admin/round-setup-wizard.utils.js";
import type { INominationEntry } from "../classes/Nomination.js";
import Game from "../classes/Game.js";
import { createDefaultNextRoundWizardState } from "../classes/AdminWizardSession.js";

function makeNomination(params: Partial<INominationEntry> & { id: number }): INominationEntry {
  return {
    id: params.id,
    roundNumber: params.roundNumber ?? 100,
    userId: params.userId ?? "100",
    gameTitle: params.gameTitle ?? "Game",
    gamedbGameId: params.gamedbGameId ?? params.id,
    nominatedAt: params.nominatedAt ?? new Date("2026-01-01T00:00:00.000Z"),
    reason: params.reason ?? null,
  };
}

test("toNominationOptionMap deduplicates by GameDB id and preserves nominator metadata", () => {
  const options = toNominationOptionMap([
    makeNomination({
      id: 1,
      userId: "111",
      gameTitle: "Alpha",
      gamedbGameId: 9,
      reason: "reason-a",
    }),
    makeNomination({
      id: 2,
      userId: "222",
      gameTitle: "Alpha",
      gamedbGameId: 9,
      reason: "reason-b",
    }),
  ]);

  assert.equal(options.size, 1);
  const first = [...options.values()][0];
  assert.ok(first);
  assert.equal(first?.nominationId, 1);
  assert.deepEqual(first?.userIds.sort(), ["111", "222"]);
  assert.deepEqual(first?.reasons.sort(), ["reason-a", "reason-b"]);
});

test("normalizeOrder keeps preferred order and appends missing picks deterministically", () => {
  const selected = [10, 20, 30];
  const preferred = [30, 999, 10];
  const ordered = normalizeOrder(selected, preferred);
  assert.deepEqual(ordered, [30, 10, 20]);
});

test("buildNominationPreviewLine includes title, game id, and nominator mention", () => {
  const line = buildNominationPreviewLine(0, {
    nominationId: 1,
    gameTitle: "Example",
    gamedbGameId: 42,
    userIds: ["777"],
    reasons: [],
  });
  assert.equal(line.includes("Example"), true);
  assert.equal(line.includes("GameDB 42"), true);
  assert.equal(line.includes("<@777>"), true);
});

test("mapSelectedNominationsToRoundPayloads maps ordered picks into round payloads", async () => {
  const originalGetGameById = Game.getGameById;
  (Game.getGameById as unknown) = async (id: number) => ({ id, title: `Game ${id}` });
  try {
    const gotmOptions = new Map([
      [1, { nominationId: 1, gameTitle: "G1", gamedbGameId: 10, userIds: ["1"], reasons: [] }],
      [2, { nominationId: 2, gameTitle: "G2", gamedbGameId: 20, userIds: ["2"], reasons: [] }],
    ]);
    const nrOptions = new Map([
      [3, { nominationId: 3, gameTitle: "N1", gamedbGameId: 30, userIds: ["3"], reasons: [] }],
    ]);
    const mapped = await mapSelectedNominationsToRoundPayloads({
      gotmOrder: [2, 1],
      nrOrder: [3],
      gotmOptionsByNominationId: gotmOptions,
      nrOptionsByNominationId: nrOptions,
      enforceCrossCategoryCollision: true,
    });
    assert.deepEqual(mapped.gotmGames.map((g) => g.gamedbGameId), [20, 10]);
    assert.deepEqual(mapped.nrGotmGames.map((g) => g.gamedbGameId), [30]);
  } finally {
    (Game.getGameById as unknown) = originalGetGameById;
  }
});

test("mapSelectedNominationsToRoundPayloads rejects cross-category collisions", async () => {
  const originalGetGameById = Game.getGameById;
  (Game.getGameById as unknown) = async (id: number) => ({ id, title: `Game ${id}` });
  try {
    const gotmOptions = new Map([
      [1, { nominationId: 1, gameTitle: "G1", gamedbGameId: 10, userIds: ["1"], reasons: [] }],
    ]);
    const nrOptions = new Map([
      [3, { nominationId: 3, gameTitle: "N1", gamedbGameId: 10, userIds: ["3"], reasons: [] }],
    ]);
    await assert.rejects(
      mapSelectedNominationsToRoundPayloads({
        gotmOrder: [1],
        nrOrder: [3],
        gotmOptionsByNominationId: gotmOptions,
        nrOptionsByNominationId: nrOptions,
        enforceCrossCategoryCollision: true,
      }),
      /Cross-category collision detected/,
    );
  } finally {
    (Game.getGameById as unknown) = originalGetGameById;
  }
});

test("mapSelectedNominationsToRoundPayloads rejects missing GameDB records", async () => {
  const originalGetGameById = Game.getGameById;
  (Game.getGameById as unknown) = async () => null;
  try {
    const gotmOptions = new Map([
      [1, { nominationId: 1, gameTitle: "G1", gamedbGameId: 10, userIds: ["1"], reasons: [] }],
    ]);
    const nrOptions = new Map<number, any>();
    await assert.rejects(
      mapSelectedNominationsToRoundPayloads({
        gotmOrder: [1],
        nrOrder: [],
        gotmOptionsByNominationId: gotmOptions,
        nrOptionsByNominationId: nrOptions,
        enforceCrossCategoryCollision: false,
      }),
      /no longer exists/,
    );
  } finally {
    (Game.getGameById as unknown) = originalGetGameById;
  }
});

test("splitEligibleNominations filters malformed and missing-title nominations", () => {
  const input = [
    makeNomination({ id: 1, gameTitle: "Valid", gamedbGameId: 50 }),
    makeNomination({ id: 2, gameTitle: "", gamedbGameId: 51 }),
    makeNomination({ id: 3, gameTitle: "(missing GameDB title for id 52)", gamedbGameId: 52 }),
    makeNomination({ id: 4, gameTitle: "Bad id", gamedbGameId: 0 }),
  ];

  const split = splitEligibleNominations(input);
  assert.equal(split.eligible.length, 1);
  assert.equal(split.eligible[0]?.id, 1);
  assert.equal(split.ineligible.length, 3);
  assert.deepEqual(
    split.ineligible.map((entry) => entry.reason).sort(),
    ["invalid-gamedb-id", "missing-gamedb-title", "missing-title"].sort(),
  );
});

test("resolveResumeChoice and resolveReviewDecision handle resume/cancel/timeout semantics", () => {
  assert.equal(resolveResumeChoice("resume"), "resume");
  assert.equal(resolveResumeChoice("restart"), "restart");
  assert.equal(resolveResumeChoice(null), "cancel");
  assert.equal(resolveReviewDecision("wiz-commit"), "commit");
  assert.equal(resolveReviewDecision("wiz-edit"), "edit");
  assert.equal(resolveReviewDecision(null), "cancel");
  assert.equal(isCancelInput("cancel"), true);
  assert.equal(isCancelInput("Cancel"), true);
  assert.equal(isCancelInput("proceed"), false);
});

test("applyEditTargetToState resets dependent state for step jumps", () => {
  const base = createDefaultNextRoundWizardState(false);
  base.gotmPickCount = 3;
  base.nrPickCount = 2;
  base.selectedGotmNominationIds = [1, 2, 3];
  base.selectedGotmOrder = [3, 1, 2];
  base.selectedNrGotmNominationIds = [11, 12];
  base.selectedNrGotmOrder = [12, 11];
  base.chosenVoteDateIso = "2026-04-30T00:00:00.000Z";

  const edited = applyEditTargetToState(base, "gotm-count");
  assert.equal(edited.gotmPickCount, null);
  assert.deepEqual(edited.selectedGotmNominationIds, []);
  assert.deepEqual(edited.selectedGotmOrder, []);
  assert.deepEqual(edited.selectedNrGotmNominationIds, [11, 12]);
});

test("executeRoundSetupCommit runs commit steps in transaction-safe order", async () => {
  const calls: string[] = [];
  await executeRoundSetupCommit({
    nextRound: 200,
    monthYear: "May 2026",
    finalDate: new Date("2026-05-29T00:00:00.000Z"),
    gotmGames: [{ title: "G", threadId: null, redditUrl: null, gamedbGameId: 10 }],
    nrGotmGames: [{ title: "N", threadId: null, redditUrl: null, gamedbGameId: 20 }],
    testMode: false,
    insertGotmRound: async () => { calls.push("insert-gotm"); },
    addGotmRound: () => { calls.push("add-gotm"); },
    insertNrGotmRound: async () => {
      calls.push("insert-nr");
      return [501];
    },
    addNrGotmRound: () => { calls.push("add-nr"); },
    setRoundInfo: async () => { calls.push("set-round-info"); },
  });
  assert.deepEqual(calls, [
    "insert-gotm",
    "add-gotm",
    "insert-nr",
    "add-nr",
    "set-round-info",
  ]);
});

test("executeRoundSetupCommit skips writers in test mode", async () => {
  let called = 0;
  await executeRoundSetupCommit({
    nextRound: 200,
    monthYear: "May 2026",
    finalDate: new Date("2026-05-29T00:00:00.000Z"),
    gotmGames: [],
    nrGotmGames: [],
    testMode: true,
    insertGotmRound: async () => { called += 1; },
    addGotmRound: () => { called += 1; },
    insertNrGotmRound: async () => {
      called += 1;
      return [];
    },
    addNrGotmRound: () => { called += 1; },
    setRoundInfo: async () => { called += 1; },
  });
  assert.equal(called, 0);
});
