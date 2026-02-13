import type { RawModalFeature, RawModalFlow } from "./RawModalScope.js";

export type RawModalFieldValues = Record<string, unknown>;
export type RawModalAttachmentValues = Record<string, unknown>;

export interface IRawModalOpenRequest {
  interactionId: string;
  interactionToken: string;
  feature: RawModalFeature;
  flow: RawModalFlow;
  sessionId: string;
  title: string;
  components: unknown[];
}

export interface IRawModalSubmitContext {
  interactionId: string;
  interactionToken: string;
  customId: string;
  userId: string;
  guildId?: string;
  channelId?: string;
  values: RawModalFieldValues;
  attachments: RawModalAttachmentValues;
}

export interface IRawModalFollowUpRequest {
  content?: string;
  flags?: number;
  components?: unknown[];
  embeds?: unknown[];
}

export interface IRawModalApiService {
  openModal(request: IRawModalOpenRequest): Promise<void>;
  parseSubmit(interactionPayload: unknown): IRawModalSubmitContext | null;
  ackSubmit(interactionId: string, interactionToken: string): Promise<void>;
  followUp(interactionToken: string, body: IRawModalFollowUpRequest): Promise<void>;
}
