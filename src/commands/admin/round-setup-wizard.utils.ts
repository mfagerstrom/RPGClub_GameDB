import type { INominationEntry } from "../../classes/Nomination.js";
import type { IGotmGame } from "../../classes/Gotm.js";
import type { INrGotmGame } from "../../classes/NrGotm.js";
import Game from "../../classes/Game.js";
import type { INextRoundWizardState } from "../../classes/AdminWizardSession.js";

export type WizardNominationOption = {
  nominationId: number;
  gameTitle: string;
  gamedbGameId: number;
  userIds: string[];
  reasons: string[];
};

export type NominationIneligibilityReason =
  | "missing-id"
  | "missing-gamedb-id"
  | "invalid-gamedb-id"
  | "missing-title"
  | "missing-gamedb-title";

export type IneligibleNomination = {
  nominationId: number | null;
  gamedbGameId: number | null;
  reason: NominationIneligibilityReason;
};

export function splitEligibleNominations(nominations: INominationEntry[]): {
  eligible: INominationEntry[];
  ineligible: IneligibleNomination[];
} {
  const eligible: INominationEntry[] = [];
  const ineligible: IneligibleNomination[] = [];

  for (const nomination of nominations) {
    if (!Number.isInteger(nomination.id) || nomination.id <= 0) {
      ineligible.push({
        nominationId: null,
        gamedbGameId: Number.isFinite(nomination.gamedbGameId) ? nomination.gamedbGameId : null,
        reason: "missing-id",
      });
      continue;
    }
    if (nomination.gamedbGameId == null) {
      ineligible.push({
        nominationId: nomination.id,
        gamedbGameId: null,
        reason: "missing-gamedb-id",
      });
      continue;
    }
    if (!Number.isInteger(nomination.gamedbGameId) || nomination.gamedbGameId <= 0) {
      ineligible.push({
        nominationId: nomination.id,
        gamedbGameId: nomination.gamedbGameId,
        reason: "invalid-gamedb-id",
      });
      continue;
    }
    if (!nomination.gameTitle?.trim()) {
      ineligible.push({
        nominationId: nomination.id,
        gamedbGameId: nomination.gamedbGameId,
        reason: "missing-title",
      });
      continue;
    }
    if (/^\(missing GameDB title for id \d+\)$/i.test(nomination.gameTitle.trim())) {
      ineligible.push({
        nominationId: nomination.id,
        gamedbGameId: nomination.gamedbGameId,
        reason: "missing-gamedb-title",
      });
      continue;
    }
    eligible.push(nomination);
  }

  return { eligible, ineligible };
}

export function toNominationOptionMap(
  nominations: INominationEntry[],
): Map<number, WizardNominationOption> {
  const byGame = new Map<number, WizardNominationOption>();
  for (const nomination of nominations) {
    const existing = byGame.get(nomination.gamedbGameId);
    if (!existing) {
      byGame.set(nomination.gamedbGameId, {
        nominationId: nomination.id,
        gameTitle: nomination.gameTitle,
        gamedbGameId: nomination.gamedbGameId,
        userIds: [nomination.userId],
        reasons: nomination.reason ? [nomination.reason] : [],
      });
      continue;
    }
    if (!existing.userIds.includes(nomination.userId)) {
      existing.userIds.push(nomination.userId);
    }
    if (nomination.reason) {
      existing.reasons.push(nomination.reason);
    }
  }
  return new Map([...byGame.entries()].sort((a, b) => a[1].gameTitle.localeCompare(b[1].gameTitle)));
}

export function buildNominationPreviewLine(index: number, option: WizardNominationOption): string {
  const nominators = option.userIds.map((userId) => `<@${userId}>`).join(", ");
  return `${index + 1}. **${option.gameTitle}** (GameDB ${option.gamedbGameId}) by ${nominators}`;
}

export function normalizeOrder(selected: number[], preferredOrder: number[]): number[] {
  const picked = new Set(selected);
  const ordered = preferredOrder.filter((id) => picked.has(id));
  for (const id of selected) {
    if (!ordered.includes(id)) {
      ordered.push(id);
    }
  }
  return ordered;
}

export function resolveResumeChoice(choice: string | null): "resume" | "restart" | "cancel" {
  if (choice === "resume") return "resume";
  if (choice === "restart") return "restart";
  return "cancel";
}

export function isCancelInput(value: string): boolean {
  return /^cancel$/i.test(value.trim());
}

export function resolveReviewDecision(
  customId: string | null,
): "commit" | "edit" | "cancel" {
  if (customId === "wiz-commit") return "commit";
  if (customId === "wiz-edit") return "edit";
  return "cancel";
}

export function applyEditTargetToState(
  state: INextRoundWizardState,
  editTarget: string,
): INextRoundWizardState {
  if (editTarget === "gotm-count") {
    return {
      ...state,
      step: "gotm-count",
      gotmPickCount: null,
      selectedGotmNominationIds: [],
      selectedGotmOrder: [],
    };
  }
  if (editTarget === "gotm-select") {
    return {
      ...state,
      step: "gotm-select",
      selectedGotmNominationIds: [],
      selectedGotmOrder: [],
    };
  }
  if (editTarget === "gotm-order") {
    return {
      ...state,
      step: "gotm-order",
      selectedGotmOrder: [],
    };
  }
  if (editTarget === "nr-count") {
    return {
      ...state,
      step: "nr-count",
      nrPickCount: null,
      selectedNrGotmNominationIds: [],
      selectedNrGotmOrder: [],
    };
  }
  if (editTarget === "nr-select") {
    return {
      ...state,
      step: "nr-select",
      selectedNrGotmNominationIds: [],
      selectedNrGotmOrder: [],
    };
  }
  if (editTarget === "nr-order") {
    return {
      ...state,
      step: "nr-order",
      selectedNrGotmOrder: [],
    };
  }
  if (editTarget === "date-choice") {
    return {
      ...state,
      step: "date-choice",
      chosenVoteDateIso: null,
    };
  }
  return state;
}

function assertUniqueGameIds(gameIds: number[], label: string): void {
  const seen = new Set<number>();
  for (const id of gameIds) {
    if (seen.has(id)) {
      throw new Error(`Duplicate ${label} selection detected for GameDB id ${id}.`);
    }
    seen.add(id);
  }
}

export async function mapSelectedNominationsToRoundPayloads(params: {
  gotmOrder: number[];
  nrOrder: number[];
  gotmOptionsByNominationId: Map<number, WizardNominationOption>;
  nrOptionsByNominationId: Map<number, WizardNominationOption>;
  enforceCrossCategoryCollision: boolean;
}): Promise<{ gotmGames: IGotmGame[]; nrGotmGames: INrGotmGame[] }> {
  const gotmOptions = params.gotmOrder.map((id) => params.gotmOptionsByNominationId.get(id));
  const nrOptions = params.nrOrder.map((id) => params.nrOptionsByNominationId.get(id));

  if (gotmOptions.some((opt) => !opt) || nrOptions.some((opt) => !opt)) {
    throw new Error("One or more selected nominations are no longer valid.");
  }

  const gotmResolved = gotmOptions as WizardNominationOption[];
  const nrResolved = nrOptions as WizardNominationOption[];

  const gotmGameIds = gotmResolved.map((option) => option.gamedbGameId);
  const nrGameIds = nrResolved.map((option) => option.gamedbGameId);

  assertUniqueGameIds(gotmGameIds, "GOTM");
  assertUniqueGameIds(nrGameIds, "NR-GOTM");

  if (params.enforceCrossCategoryCollision) {
    const nrSet = new Set(nrGameIds);
    const collision = gotmGameIds.find((id) => nrSet.has(id));
    if (collision) {
      throw new Error(
        `Cross-category collision detected. GameDB id ${collision} cannot be in both categories.`,
      );
    }
  }

  const uniqueIds = [...new Set([...gotmGameIds, ...nrGameIds])];
  for (const gameId of uniqueIds) {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error(`Invalid GameDB id detected in selection: ${gameId}.`);
    }
    const game = await Game.getGameById(gameId);
    if (!game) {
      throw new Error(`Selected GameDB id ${gameId} no longer exists.`);
    }
  }

  const gotmGames: IGotmGame[] = gotmResolved.map((option) => ({
    title: option.gameTitle,
    threadId: null,
    redditUrl: null,
    gamedbGameId: option.gamedbGameId,
  }));
  const nrGotmGames: INrGotmGame[] = nrResolved.map((option) => ({
    title: option.gameTitle,
    threadId: null,
    redditUrl: null,
    gamedbGameId: option.gamedbGameId,
  }));

  return { gotmGames, nrGotmGames };
}

export async function executeRoundSetupCommit(params: {
  nextRound: number;
  monthYear: string;
  finalDate: Date;
  gotmGames: IGotmGame[];
  nrGotmGames: INrGotmGame[];
  testMode: boolean;
  insertGotmRound: (round: number, monthYear: string, games: IGotmGame[]) => Promise<void>;
  addGotmRound: (round: number, monthYear: string, games: IGotmGame[]) => void;
  insertNrGotmRound: (round: number, monthYear: string, games: INrGotmGame[]) => Promise<number[]>;
  addNrGotmRound: (round: number, monthYear: string, games: INrGotmGame[]) => void;
  setRoundInfo: (round: number, nextVoteAt: Date, nominationListId: number | null) => Promise<void>;
}): Promise<void> {
  if (params.testMode) {
    return;
  }

  await params.insertGotmRound(params.nextRound, params.monthYear, params.gotmGames);
  params.addGotmRound(params.nextRound, params.monthYear, params.gotmGames);

  const insertedIds = await params.insertNrGotmRound(
    params.nextRound,
    params.monthYear,
    params.nrGotmGames,
  );
  const withIds = params.nrGotmGames.map((entry, index) => ({
    ...entry,
    id: insertedIds[index] ?? null,
  }));
  params.addNrGotmRound(params.nextRound, params.monthYear, withIds);

  await params.setRoundInfo(params.nextRound, params.finalDate, null);
}
