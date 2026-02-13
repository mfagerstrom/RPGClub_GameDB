import type {
  APIAttachment,
  APIInteraction,
  APIInteractionResponseCallbackData,
  APIModalInteractionResponseCallbackComponent,
} from "discord-api-types/v10";
import type { RESTPostAPIInteractionFollowupResult } from "discord-api-types/rest/v10/interactions";
import type { RawModalFeature, RawModalFlow } from "./RawModalScope.js";

export type RawModalSubmittedValue = string | string[] | boolean | null;
export type RawModalFieldValues = Record<string, RawModalSubmittedValue>;
export type RawModalAttachmentValues = Record<string, APIAttachment>;

export interface IRawModalOpenRequest {
  interactionId: string;
  interactionToken: string;
  feature: RawModalFeature;
  flow: RawModalFlow;
  sessionId: string;
  customId?: string;
  title: string;
  components: APIModalInteractionResponseCallbackComponent[];
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
  message: APIInteractionResponseCallbackData;
}

export interface IRawModalApiService {
  openModal(request: IRawModalOpenRequest): Promise<void>;
  parseSubmit(interactionPayload: APIInteraction | unknown): IRawModalSubmitContext | null;
  ackSubmit(interactionId: string, interactionToken: string): Promise<void>;
  followUp(
    interactionToken: string,
    request: IRawModalFollowUpRequest,
  ): Promise<RESTPostAPIInteractionFollowupResult>;
}
