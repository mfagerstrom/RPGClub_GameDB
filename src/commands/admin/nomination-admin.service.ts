import type { CommandInteraction, User, ButtonInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { safeReply, sanitizeUserInput } from "../../functions/InteractionUtils.js";
import {
  deleteNominationForUser,
  getNominationForUser,
  listNominationsForRound,
} from "../../classes/Nomination.js";
import { getUpcomingNominationWindow } from "../../functions/NominationWindow.js";
import {
  buildNominationDeleteView,
  handleNominationDeletionButton,
  buildNominationDeleteViewEmbed,
  announceNominationChange,
} from "../../functions/NominationAdminHelpers.js";

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
    const embed = buildNominationDeleteViewEmbed("GOTM", "/nominate", targetRound, window, nominations);
    const adminName = interaction.user.tag ?? interaction.user.username ?? interaction.user.id;
    const content = `${adminName} deleted <@${user.id}>'s nomination "${nomination.gameTitle}" for GOTM Round ${targetRound}. Reason: ${reason}`;

    await interaction.deleteReply().catch(() => {});

    await announceNominationChange("gotm", interaction as any, content, embed);
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
    const embed = buildNominationDeleteViewEmbed("NR-GOTM", "/nominate", targetRound, window, nominations);
    const adminName = interaction.user.tag ?? interaction.user.username ?? interaction.user.id;
    const content = `${adminName} deleted <@${user.id}>'s nomination "${nomination.gameTitle}" for NR-GOTM Round ${targetRound}. Reason: ${reason}`;

    await interaction.deleteReply().catch(() => {});

    await announceNominationChange("nr-gotm", interaction as any, content, embed);
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
  const view = await buildNominationDeleteView("gotm", "/nominate", "admin");
  if (!view) {
    await safeReply(interaction, {
      content: `No GOTM nominations found for Round ${window.targetRound}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await safeReply(interaction, {
    content: `Select a GOTM nomination to delete for Round ${window.targetRound}.`,
    embeds: [view.embed],
    components: view.components,
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleDeleteNrGotmNomsPanel(interaction: CommandInteraction): Promise<void> {
  const window = await getUpcomingNominationWindow();
  const view = await buildNominationDeleteView("nr-gotm", "/nominate", "admin");
  if (!view) {
    await safeReply(interaction, {
      content: `No NR-GOTM nominations found for Round ${window.targetRound}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await safeReply(interaction, {
    content: `Select an NR-GOTM nomination to delete for Round ${window.targetRound}.`,
    embeds: [view.embed],
    components: view.components,
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleAdminNominationDeleteButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const match = interaction.customId.match(/^admin-(gotm|nr-gotm)-nom-del-(\d+)-(\d+)$/);
  if (!match) return;
  const kind = match[1] as "gotm" | "nr-gotm";
  const round = Number(match[2]);
  const userId = match[3];

  await handleNominationDeletionButton(interaction, kind, round, userId, "admin");
}
