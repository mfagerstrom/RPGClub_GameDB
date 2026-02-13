import { ComponentType } from "discord.js";
import type {
  ActionRowModalData,
  LabelModalData,
  ModalData,
  ModalSubmitInteraction,
} from "discord.js";

export interface IRawModalSubmitValidationResult {
  ok: boolean;
  reason?: string;
}

const MAX_CUSTOM_ID_LENGTH = 100;
const MAX_TEXT_INPUT_LENGTH = 4000;
const MAX_SELECT_VALUES = 25;
const MAX_FILE_UPLOAD_VALUES = 10;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateCustomId(customId: unknown): IRawModalSubmitValidationResult {
  if (!isNonEmptyString(customId)) {
    return { ok: false, reason: "component custom id is missing" };
  }

  if (customId.length > MAX_CUSTOM_ID_LENGTH) {
    return { ok: false, reason: "component custom id exceeds 100 characters" };
  }

  return { ok: true };
}

function validateSelectValues(values: readonly string[]): IRawModalSubmitValidationResult {
  if (!Array.isArray(values)) {
    return { ok: false, reason: "select values must be an array" };
  }
  if (values.length > MAX_SELECT_VALUES) {
    return { ok: false, reason: "select values exceed allowed limit" };
  }
  if (!values.every((entry) => typeof entry === "string")) {
    return { ok: false, reason: "select values contain a non-string value" };
  }
  return { ok: true };
}

function validateFileUploadValues(
  values: readonly string[],
  attachmentIds: ReadonlySet<string>,
): IRawModalSubmitValidationResult {
  if (!Array.isArray(values) || values.length === 0) {
    return { ok: false, reason: "file upload must contain at least one attachment id" };
  }
  if (values.length > MAX_FILE_UPLOAD_VALUES) {
    return { ok: false, reason: "file upload contains too many attachment ids" };
  }
  for (const attachmentId of values) {
    if (!isNonEmptyString(attachmentId)) {
      return { ok: false, reason: "file upload attachment id is invalid" };
    }
    if (!attachmentIds.has(attachmentId)) {
      return { ok: false, reason: "file upload attachment id is unresolved" };
    }
  }
  return { ok: true };
}

function validateModalField(field: ModalData): IRawModalSubmitValidationResult {
  const customIdCheck = validateCustomId((field as { customId?: unknown }).customId);
  if (!customIdCheck.ok) {
    return customIdCheck;
  }

  switch (field.type) {
    case ComponentType.TextInput: {
      const value = (field as { value?: unknown }).value;
      if (typeof value !== "string") {
        return { ok: false, reason: "text input value must be a string" };
      }
      if (value.length > MAX_TEXT_INPUT_LENGTH) {
        return { ok: false, reason: "text input value exceeds max length" };
      }
      return { ok: true };
    }
    case ComponentType.StringSelect:
    case ComponentType.UserSelect:
    case ComponentType.RoleSelect:
    case ComponentType.MentionableSelect:
    case ComponentType.ChannelSelect:
      return validateSelectValues((field as { values: readonly string[] }).values);
    case ComponentType.FileUpload:
      return validateFileUploadValues(
        (field as { values: readonly string[] }).values,
        new Set((field as { attachments: ReadonlyMap<string, unknown> }).attachments.keys()),
      );
    default:
      return { ok: false, reason: "unsupported modal field type" };
  }
}

function collectModalFields(
  components: readonly (ActionRowModalData | LabelModalData)[],
): ModalData[] {
  const fields: ModalData[] = [];
  for (const component of components) {
    if (component.type === ComponentType.ActionRow) {
      for (const child of component.components) {
        fields.push(child);
      }
      continue;
    }

    if (component.type === ComponentType.Label) {
      fields.push(component.component);
    }
  }
  return fields;
}

export function validateRawModalSubmitInteractionPayload(
  interaction: ModalSubmitInteraction,
): IRawModalSubmitValidationResult {
  const customIdCheck = validateCustomId(interaction.customId);
  if (!customIdCheck.ok) {
    return { ok: false, reason: `modal custom id invalid: ${customIdCheck.reason}` };
  }

  const fields = collectModalFields(interaction.components);
  if (fields.length === 0) {
    return { ok: false, reason: "modal submit has no submitted fields" };
  }

  const seenCustomIds = new Set<string>();
  for (const field of fields) {
    const customId = (field as { customId?: string }).customId ?? "";
    if (seenCustomIds.has(customId)) {
      return { ok: false, reason: "duplicate component custom id detected in modal submit" };
    }
    seenCustomIds.add(customId);

    const fieldCheck = validateModalField(field);
    if (!fieldCheck.ok) {
      return fieldCheck;
    }
  }

  return { ok: true };
}
