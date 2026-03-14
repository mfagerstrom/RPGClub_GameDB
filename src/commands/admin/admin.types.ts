import { ButtonStyle } from "discord.js";

export type AdminHelpTopicId =
  | "add-gotm"
  | "edit-gotm"
  | "add-nr-gotm"
  | "edit-nr-gotm"
  | "gotm-audit"
  | "delete-gotm-noms"
  | "delete-nr-gotm-noms"
  | "set-nextvote"
  | "voting-setup"
  | "nextround-setup"
  | "sync";

export type AdminHelpTopic = {
  id: AdminHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  parameters?: string;
  notes?: string;
};

export const GOTM_AUDIT_ACTIONS = ["start", "resume", "pause", "cancel", "status"] as const;
export type GotmAuditAction = (typeof GOTM_AUDIT_ACTIONS)[number];

export const GOTM_AUDIT_SELECT_PREFIX = "gotm-audit-select";
export const GOTM_AUDIT_ACTION_PREFIX = "gotm-audit-action";
export const GOTM_AUDIT_MANUAL_PREFIX = "gotm-audit-manual";
export const GOTM_AUDIT_MANUAL_INPUT_ID = "gotm-audit-manual-gamedb-id";
export const GOTM_AUDIT_QUERY_PREFIX = "gotm-audit-query";
export const GOTM_AUDIT_QUERY_INPUT_ID = "gotm-audit-query-text";
export const GOTM_AUDIT_RESULT_LIMIT = 25;

export type GotmAuditParsedRow = {
  rowIndex: number;
  kind: "gotm" | "nr-gotm";
  roundNumber: number;
  monthYear: string;
  gameIndex: number;
  gameTitle: string;
  threadId: string | null;
  redditUrl: string | null;
  gameDbGameId: number | null;
};

export type PromptChoiceOption = {
  label: string;
  value: string;
  style?: ButtonStyle;
};

export type WizardAction = {
  description: string;
  execute: () => Promise<void>;
};

export const VOTING_TITLE_MAX_LEN = 38;
