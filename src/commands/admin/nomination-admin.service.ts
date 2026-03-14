import type {
  ButtonInteraction,
  CommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  User,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { safeDeferReply, safeReply, sanitizeUserInput } from "../../functions/InteractionUtils.js";
import {
  deleteNominationForUser,
  getNominationForUser,
  listNominationsForRound,
} from "../../classes/Nomination.js";
import { getUpcomingNominationWindow } from "../../functions/NominationWindow.js";
import {
  announceNominationChange,
  buildDeletionReasonModal,
  buildDeletionSelectControls,
  buildDeletionConfirmationView,
  buildNominationDeleteView,
  createDeletionConfirmSession,
  createDeletionReasonSession,
  handleNominationDeletionButton,
  parseDeletionConfirmCustomId,
  parseDeletionReasonModalCustomId,
  parseDeletionSelectCustomId,
  readDeletionReasonSession,
  markDeletionReasonSessionSubmitted,
} from "../../functions/NominationAdminHelpers.js";
import {
  buildComponentsV2Flags,
  buildNominationListPayload,
} from "../../functions/NominationListComponents.js";

export async function handleDeleteGotmNomination(
  interaction: CommandInteraction,
  user: User,
  reason: string,
): Promise<void> {
  reason = sanitizeUserInput(reason, { preserveNewlines: true });

  try {
    const window = await getUpcomingNominationWindow();
    const targetRound = window.targetRound;
    const nomination = await getNominationForUser("gotm", targetRound, user.id);
    const targetUser = await interaction.client.users.fetch(user.id).catch(() => user);
    const targetName = targetUser?.tag ?? user.tag ?? user.username ?? user.id;

    if (!nomination) {
      await safeReply(interaction, {
        content: `No GOTM nomination found for Round ${targetRound} by ${targetName}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await deleteNominationForUser("gotm", targetRound, user.id);
    const nominations = await listNominationsForRound("gotm", targetRound);
    const payload = await buildNominationListPayload(
      "GOTM",
      "/nominate",
      {
        ...window,
        targetRound,
      },
      nominations,
      false,
    );
    const adminName = interaction.user.tag ?? interaction.user.username ?? interaction.user.id;
    const content = `${adminName} deleted <@${user.id}>'s nomination "${nomination.gameTitle}" for GOTM Round ${targetRound}. Reason: ${reason}`;

    await interaction.deleteReply().catch(() => {});
    await announceNominationChange("gotm", interaction as any, content, payload);
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await safeReply(interaction, {
      content: `Failed to delete nomination: ${msg}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleDeleteNrGotmNomination(
  interaction: CommandInteraction,
  user: User,
  reason: string,
): Promise<void> {
  reason = sanitizeUserInput(reason, { preserveNewlines: true });

  try {
    const window = await getUpcomingNominationWindow();
    const targetRound = window.targetRound;
    const nomination = await getNominationForUser("nr-gotm", targetRound, user.id);
    const targetUser = await interaction.client.users.fetch(user.id).catch(() => user);
    const targetName = targetUser?.tag ?? user.tag ?? user.username ?? user.id;

    if (!nomination) {
      await safeReply(interaction, {
        content: `No NR-GOTM nomination found for Round ${targetRound} by ${targetName}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await deleteNominationForUser("nr-gotm", targetRound, user.id);
    const nominations = await listNominationsForRound("nr-gotm", targetRound);
    const payload = await buildNominationListPayload(
      "NR-GOTM",
      "/nominate",
      {
        ...window,
        targetRound,
      },
      nominations,
      false,
    );
    const adminName = interaction.user.tag ?? interaction.user.username ?? interaction.user.id;
    const content = `${adminName} deleted <@${user.id}>'s nomination "${nomination.gameTitle}" for NR-GOTM Round ${targetRound}. Reason: ${reason}`;

    await interaction.deleteReply().catch(() => {});
    await announceNominationChange("nr-gotm", interaction as any, content, payload);
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await safeReply(interaction, {
      content: `Failed to delete nomination: ${msg}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleDeleteGotmNomsPanel(interaction: CommandInteraction): Promise<void> {
  const window = await getUpcomingNominationWindow();
  const view = await buildNominationDeleteView("gotm", "/nominate");
  if (!view) {
    await safeReply(interaction, {
      content: `No GOTM nominations found for Round ${window.targetRound}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await safeReply(interaction, {
    content: `Choose a GOTM nomination for Round ${window.targetRound} to start deletion.`,
    components: [...view.payload.components, ...view.controls],
    files: view.payload.files,
    flags: buildComponentsV2Flags(true),
  });
}

export async function handleDeleteNrGotmNomsPanel(interaction: CommandInteraction): Promise<void> {
  const window = await getUpcomingNominationWindow();
  const view = await buildNominationDeleteView("nr-gotm", "/nominate");
  if (!view) {
    await safeReply(interaction, {
      content: `No NR-GOTM nominations found for Round ${window.targetRound}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await safeReply(interaction, {
    content: `Choose an NR-GOTM nomination for Round ${window.targetRound} to start deletion.`,
    components: [...view.payload.components, ...view.controls],
    files: view.payload.files,
    flags: buildComponentsV2Flags(true),
  });
}

export async function handleAdminNominationDeleteSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const parsed = parseDeletionSelectCustomId(interaction.customId);
  const selectedUserId = interaction.values?.[0];
  if (!parsed || !selectedUserId) {
    await safeReply(interaction, {
      content: "This nomination deletion menu is invalid. Run the command again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const nomination = await getNominationForUser(parsed.kind, parsed.round, selectedUserId);
  if (!nomination) {
    await safeReply(interaction, {
      content: "That nomination no longer exists. Run the command again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sessionId = await createDeletionReasonSession(interaction, {
    kind: parsed.kind,
    round: parsed.round,
    userId: selectedUserId,
    gameTitle: nomination.gameTitle,
  });

  await interaction.showModal(buildDeletionReasonModal(sessionId, nomination.gameTitle)).catch(async () => {
    await safeReply(interaction, {
      content: "Unable to open the deletion reason prompt. Try again.",
      flags: MessageFlags.Ephemeral,
    });
  });
}

export async function handleAdminNominationDeleteReasonModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const parsed = parseDeletionReasonModalCustomId(interaction.customId);
  if (!parsed) {
    await safeReply(interaction, {
      content: "This nomination deletion prompt is invalid. Run the command again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sessionState = await readDeletionReasonSession(parsed.sessionId, interaction.user.id);
  if (!sessionState) {
    await safeReply(interaction, {
      content: "This nomination deletion prompt expired. Run the command again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const reason = sanitizeUserInput(
    interaction.fields.getTextInputValue("admin-nom-del-reason-input"),
    { preserveNewlines: true, maxLength: 250 },
  );
  if (!reason) {
    await safeReply(interaction, {
      content: "A deletion reason is required.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await markDeletionReasonSessionSubmitted(parsed.sessionId);
  const confirmSessionId = await createDeletionConfirmSession(interaction, {
    ...sessionState,
    reason,
  });
  const confirmationView = await buildDeletionConfirmationView(
    sessionState.kind,
    sessionState.round,
    reason,
    confirmSessionId,
  );

  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
  await safeReply(interaction, {
    content:
      `Review the ${sessionState.kind === "gotm" ? "GOTM" : "NR-GOTM"} nomination list below, ` +
      `then click Delete Nomination to remove "${sessionState.gameTitle}".`,
    components: [...confirmationView.payload.components, ...confirmationView.controls],
    files: confirmationView.payload.files,
    flags: buildComponentsV2Flags(true),
  });
}

export async function handleAdminNominationDeleteConfirmButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const parsed = parseDeletionConfirmCustomId(interaction.customId);
  if (!parsed) {
    return;
  }

  await handleNominationDeletionButton(interaction, parsed.sessionId);
}

export async function buildDeleteViewForTests(
  kind: "gotm" | "nr-gotm",
  round: number,
): Promise<Array<any>> {
  const nominations = await listNominationsForRound(kind, round);
  const payload = await buildNominationListPayload(
    kind === "gotm" ? "GOTM" : "NR-GOTM",
    "/nominate",
    {
      closesAt: new Date("2026-03-13T12:00:00.000Z"),
      nextVoteAt: new Date("2026-03-20T12:00:00.000Z"),
      targetRound: round,
    },
    nominations,
    false,
    { includeDetailSelect: false },
  );

  return [...payload.components, ...buildDeletionSelectControls(kind, round, nominations)];
}
