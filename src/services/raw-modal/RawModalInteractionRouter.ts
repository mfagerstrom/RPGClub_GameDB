import { MessageFlags, type Interaction } from "discord.js";
import { safeDeferReply, safeReply } from "../../functions/InteractionUtils.js";
import { parseRawModalCustomId } from "./RawModalCustomId.js";
import { RAW_MODAL_CUSTOM_ID_PREFIX } from "./RawModalScope.js";
import { isRawModalPilotEnabled } from "./RawModalFeatureFlag.js";
import {
  claimRawModalSessionForSubmit,
  expireRawModalSession,
  getRawModalSessionRecord,
  isRawModalSessionExpired,
} from "./RawModalSession.js";
import { validateRawModalSubmitInteractionPayload } from "./RawModalSubmitValidation.js";
import { logRawModal } from "./RawModalLogging.js";

const RAW_MODAL_PREFIX = `${RAW_MODAL_CUSTOM_ID_PREFIX}:`;

function getInteractionCustomId(interaction: Interaction): string | null {
  if (interaction.isMessageComponent()) {
    return interaction.customId;
  }
  if (interaction.isModalSubmit()) {
    return interaction.customId;
  }
  return null;
}

async function handleManagedRawModalInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable()) {
    return;
  }

  await safeReply(interaction, {
    content: "This modal flow is reserved for direct API routing and is not wired yet.",
    flags: MessageFlags.Ephemeral,
  });
}

async function sendSessionRecoveryMessage(
  interaction: Interaction,
  content: string,
): Promise<void> {
  if (!interaction.isRepliable()) return;
  await safeReply(interaction, {
    content,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleManagedRawModalSubmit(
  interaction: Interaction,
  sessionId: string,
): Promise<void> {
  if (!interaction.isModalSubmit()) {
    return;
  }

  logRawModal("info", "submit.received", {
    sessionId,
    userId: interaction.user.id,
    customId: interaction.customId,
  });

  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

  const validation = validateRawModalSubmitInteractionPayload(interaction);
  if (!validation.ok) {
    logRawModal("warn", "submit.invalid_payload", {
      sessionId,
      userId: interaction.user.id,
      reason: validation.reason,
    });
    await sendSessionRecoveryMessage(
      interaction,
      "Your modal submission payload was invalid. Please reopen the flow and try again.",
    );
    return;
  }

  const session = await getRawModalSessionRecord(sessionId);
  if (!session) {
    logRawModal("warn", "submit.session_missing", {
      sessionId,
      userId: interaction.user.id,
    });
    await sendSessionRecoveryMessage(
      interaction,
      "This modal session was not found. Please reopen the flow and try again.",
    );
    return;
  }

  if (session.ownerUserId !== interaction.user.id) {
    logRawModal("warn", "submit.owner_mismatch", {
      sessionId,
      userId: interaction.user.id,
    });
    await sendSessionRecoveryMessage(
      interaction,
      "This modal belongs to a different user. Please start your own modal flow.",
    );
    return;
  }

  if (isRawModalSessionExpired(session)) {
    if (session.status === "open") {
      await expireRawModalSession(session.sessionId);
    }
    logRawModal("warn", "submit.session_expired", {
      sessionId,
      userId: interaction.user.id,
    });
    await sendSessionRecoveryMessage(
      interaction,
      "This modal session expired. Please reopen the flow to continue.",
    );
    return;
  }

  if (session.status !== "open") {
    logRawModal("warn", "submit.session_not_open", {
      sessionId,
      userId: interaction.user.id,
      reason: session.status,
    });
    await sendSessionRecoveryMessage(
      interaction,
      "This modal session is no longer active. Please reopen the flow to continue.",
    );
    return;
  }

  const claimed = await claimRawModalSessionForSubmit(session.sessionId, interaction.user.id);
  if (!claimed) {
    logRawModal("warn", "submit.claim_failed", {
      sessionId,
      userId: interaction.user.id,
    });
    await sendSessionRecoveryMessage(
      interaction,
      "This modal was already submitted or expired. Please reopen the flow.",
    );
    return;
  }

  logRawModal("info", "submit.accepted", {
    sessionId,
    userId: interaction.user.id,
  });
  await safeReply(interaction, {
    content: "Modal submission accepted for this session. Raw handling will be wired next.",
    flags: MessageFlags.Ephemeral,
  });
}

export async function tryHandleManagedRawModalInteraction(interaction: Interaction): Promise<boolean> {
  const customId = getInteractionCustomId(interaction);
  if (!customId || !customId.startsWith(RAW_MODAL_PREFIX)) {
    return false;
  }

  const parsed = parseRawModalCustomId(customId);
  if (!parsed) {
    logRawModal("warn", "dispatch.invalid_custom_id", {
      customId,
    });
    await handleManagedRawModalInteraction(interaction);
    return true;
  }

  if (!isRawModalPilotEnabled(parsed.feature, interaction.guildId)) {
    logRawModal("info", "dispatch.skipped_by_flag", {
      sessionId: parsed.sessionId,
      feature: parsed.feature,
      flow: parsed.flow,
      userId: interaction.isRepliable() ? interaction.user.id : undefined,
      customId,
      reason: "pilot_disabled_or_guild_not_allowed",
    });
    return false;
  }

  if (interaction.isModalSubmit()) {
    try {
      await handleManagedRawModalSubmit(interaction, parsed.sessionId);
    } catch (error: unknown) {
      logRawModal("error", "submit.error", {
        sessionId: parsed.sessionId,
        userId: interaction.user.id,
        error,
      });
      await sendSessionRecoveryMessage(
        interaction,
        "Something went wrong processing this modal. Please reopen the flow and try again.",
      );
    }
    return true;
  }

  logRawModal("info", "dispatch.non_submit", {
    sessionId: parsed.sessionId,
    userId: interaction.isRepliable() ? interaction.user.id : undefined,
    customId,
  });
  await handleManagedRawModalInteraction(interaction);
  return true;
}
