import test from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { safeUpdate } from "../functions/InteractionUtils.js";

test("safeUpdate falls back to editReply after acknowledged interaction", async () => {
  const calls: string[] = [];
  const interaction: any = {
    deferred: true,
    replied: false,
    user: { id: "u1" },
    update: async () => {
      const error: any = new Error("already acknowledged");
      error.code = 40060;
      throw error;
    },
    editReply: async (payload: unknown) => {
      calls.push(`edit:${JSON.stringify(payload)}`);
    },
    followUp: async (payload: unknown) => {
      calls.push(`follow:${JSON.stringify(payload)}`);
    },
    reply: async (payload: unknown) => {
      calls.push(`reply:${JSON.stringify(payload)}`);
    },
    isMessageComponent: () => true,
    __rpgAcked: true,
    __rpgDeferred: true,
  };

  await safeUpdate(interaction, {
    content: "Select platform",
    components: [],
    flags: MessageFlags.Ephemeral,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0], /^edit:/);
});
