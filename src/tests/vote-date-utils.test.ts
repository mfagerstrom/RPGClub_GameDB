import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
  calculateNextVoteDateEt,
  formatVoteDateForDisplay,
  parseVoteDateInput,
  VOTE_TIME_ZONE,
} from "../functions/VoteDateUtils.js";

test("parseVoteDateInput normalizes YYYY-MM-DD to Eastern calendar day", () => {
  const parsed = parseVoteDateInput("2026-03-28");
  assert.ok(parsed instanceof Date);

  const inEt = DateTime.fromJSDate(parsed).setZone(VOTE_TIME_ZONE);
  assert.equal(inEt.toFormat("yyyy-MM-dd"), "2026-03-28");
  assert.equal(inEt.hour, 12);
  assert.equal(formatVoteDateForDisplay(parsed), "03/28/2026");
});

test("parseVoteDateInput accepts US slash format", () => {
  const parsed = parseVoteDateInput("3/28/2026");
  assert.ok(parsed instanceof Date);
  const inEt = DateTime.fromJSDate(parsed).setZone(VOTE_TIME_ZONE);
  assert.equal(inEt.toFormat("yyyy-MM-dd"), "2026-03-28");
});

test("calculateNextVoteDateEt returns last Friday of next month in Eastern time", () => {
  const now = new Date("2026-02-10T15:00:00.000Z");
  const calculated = calculateNextVoteDateEt(now);
  const inEt = DateTime.fromJSDate(calculated).setZone(VOTE_TIME_ZONE);

  assert.equal(inEt.toFormat("yyyy-MM-dd"), "2026-03-27");
  assert.equal(inEt.weekday, 5);
  assert.equal(inEt.hour, 12);
});
