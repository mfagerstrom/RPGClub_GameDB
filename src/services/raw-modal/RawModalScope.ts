export const RAW_MODAL_CUSTOM_ID_PREFIX = "modal";
export const RAW_MODAL_SCHEMA_VERSION = 1;

export const RAW_MODAL_SUPPORTED_FEATURES = ["todo", "suggestion"] as const;
export type RawModalFeature = (typeof RAW_MODAL_SUPPORTED_FEATURES)[number];

export const RAW_MODAL_TODO_PILOT_FLOWS = [
  "create",
  "comment",
  "edit-title",
  "edit-description",
  "query",
] as const;
export type RawModalTodoPilotFlow = (typeof RAW_MODAL_TODO_PILOT_FLOWS)[number];

export const RAW_MODAL_SUGGESTION_PILOT_FLOWS = ["review-decision"] as const;
export type RawModalSuggestionPilotFlow = (typeof RAW_MODAL_SUGGESTION_PILOT_FLOWS)[number];

export type RawModalFlow = RawModalTodoPilotFlow | RawModalSuggestionPilotFlow;

export const RAW_MODAL_PILOT_COMPONENT_TYPES = [
  "FILE_UPLOAD",
  "CHECKBOX_GROUP",
  "RADIO_GROUP",
] as const;

export const RAW_MODAL_PILOT_FEATURES = ["todo", "suggestion"] as const satisfies readonly RawModalFeature[];
