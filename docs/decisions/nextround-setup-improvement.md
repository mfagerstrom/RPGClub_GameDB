**Plan**
1. Audit current nomination data surfaces and constraints.
- Confirm where active GOTM and NR-GOTM nominations are read from today, including fields needed for round insertion (title, `gamedbGameId`, optional thread/reddit links, nominee metadata).
- Verify how “upcoming round” is determined and whether nomination scope must be tied to `nextRound` or calendar month.

2. Define a durable wizard state model before UI changes.
- Add a persisted wizard session record keyed by admin user + channel + command type so flow survives bot restart.
- Store step, selected nomination IDs, selected order, chosen vote date, `testmode`, and last-updated timestamp.
- Add resume behavior when `/admin nextround-setup` is re-run and an unfinished session exists.

3. Replace stub game arrays with nomination-backed selection steps.
- Add “Pick GOTM entries” step that loads current eligible GOTM nominations and presents selectable options.
- Add “Pick NR-GOTM entries” step with the same pattern.
- Support configurable pick count and ordering (for `GAME_INDEX`) using button/select interactions.
- Include nomination preview in wizard log before confirmation.

4. Build nomination-to-round mapping layer.
- Convert selected nominations directly into `IGotmGame[]` and `INrGotmGame[]` payloads using nomination-linked `gamedbGameId`.
- Validate every selected nomination resolves to a valid game ID.
- Enforce no duplicates within a category and no cross-category collisions if that is a business rule.

5. Add eligibility and safety checks.
- Filter out ineligible nominations (deleted, withdrawn, malformed, missing game ID).
- Guard against inserting a round that already exists.
- Detect empty nomination pools and show actionable guidance instead of silent no-op behavior.

6. Upgrade confirmation and commit flow.
- Show an explicit summary: month label, selected GOTM list, selected NR-GOTM list, next vote date, and DB actions.
- Keep `Commit / Edit / Cancel`, but make Edit jump to specific step instead of full restart.
- On commit, write in transaction-safe order: round entries first, then `BOT_VOTING_INFO` update.

7. Tighten test mode and observability.
- Ensure `testmode` executes full validation and selection flow but does zero DB writes.
- Log planned SQL-level effects in summary for admin confidence.

8. Add tests.
- Unit tests for nomination filtering and mapping logic.
- Unit tests for wizard session resume and timeout/cancel behavior.
- Integration-style command tests for commit and testmode paths, including duplicate/invalid nomination cases.

9. Add targeted lint guardrails (recommended).
- Custom ESLint rule to disallow timestamp/random-only interaction IDs in command flows that require restart-resume.
- Optional rule to flag multi-step admin workflows that do not persist step state.

10. Rollout strategy.
- Ship behind a temporary feature flag for `/admin nextround-setup-v2`.
- Validate with a dry-run in admin channel, then switch primary command once verified.

Prompt restated: write a plan to improve this process, including entering real GOTM and NR-GOTM entries and selecting from current nominations instead of requiring gameDB IDs.