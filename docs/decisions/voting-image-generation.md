1. Feature contract
- Add guild-only admin slash command: `/generate-vote-image round:<int=default current round> vote_type:<GOTM|NR-GOTM>`.
- `round` defaults via existing SQL current-round lookup logic in codebase.
- Use all nominations for selected round and vote type.
- Skip nominations missing cover art blobs.
- Fail if nomination count is `0`.
- Generate one combined image and post only in invoking channel.
- No persistence to DB/filesystem for PoC.
- Title text:
  - `GOTM` -> `[GOTM] Round <roundNumber>`
  - `NR-GOTM` -> `[NR-GOTM] Round <roundNumber>`

2. Composition rules
- Output: `1920x1080` PNG, landscape optimized for Discord desktop embed width.
- Layout:
  - Adaptive templates for `2`, `3`, `4` nominations.
  - For larger counts, use uniform grid.
  - For odd counts, center the last row.
- Tile fit mode: letterbox (`contain`), no cropping.
- Spacing: `5px` outer margin.
- Background: transparent.
- Header: centered overlay, single line `[TYPE] Round N`.
- Typography: system-safe font with slight black outer glow.
- No per-game labels.

3. Rendering stack
- Use `sharp` for deterministic non-AI image generation.
- Render header text via SVG overlay.
- Input cover art from DB blobs.
- If any cover decode/load fails, fail whole render.
- Ensure deterministic output for same inputs.
- No strict render timeout; always safely defer Discord interaction.

4. Module boundaries and interfaces
- Composer service file: `src/services/voteImageComposer.ts`.
- Command handler file: `src/commands/admin/generateVoteImage.ts` (sane default path).
- Responsibility split:
  - Command handler: permission check, option parsing/default round, SQL queries, sorting, defer/edit reply, locking, errors, logs.
  - Composer service: pure composition from prepared cover inputs.
- Service API:
  - `composeVoteImage({ roundNumber, voteType, covers }): Promise<Buffer>`
- Deterministic pre-layout ordering: alphabetical by game title.
- Reuse existing SQL-based current-round resolver in codebase.
- Use specific user-facing error reasons.

5. Discord integration details
- Register command as guild-only.
- Enforce Discord `Administrator` permission.
- Non-admin response: ephemeral permission error.
- Command options:
  - `round` optional.
  - `vote_type` required enum `GOTM|NR-GOTM`.
- Reuse existing shared vote type enum/constants if already present.
- Success reply format: image attachment plus short text:
  - `Generated [TYPE] Round N from X nominations.`
- Error replies:
  - `No nominations found for [TYPE] Round N.`
  - `One or more nominations are missing cover art blobs.`
  - `Failed to decode one or more cover images.`
  - `Image generation failed. Please try again.`
- Filename convention: deterministic default `vote_<type>_round_<n>.png`.
- Interaction lifecycle: `deferReply()` then `editReply()` with success or failure.

6. Caching, persistence, concurrency
- No output persistence.
- No caching; always regenerate.
- In-progress lock key: `guildId + round + vote_type`.
- Reject overlapping request for same key while active.
- Stale lock auto-expiry: 2 minutes.
- Immediate reruns allowed after completion.
- Lock conflict message:
  - `Generation already in progress for [TYPE] Round N. Try again shortly.`
- Log lifecycle events: lock acquired, generation started, success/failure, lock released.

7. Testing strategy (deferred)
- Skip all tests for now per request.
- Validate manually in Discord during PoC.
- Revisit tests after behavior is approved.

8. Operational behavior
- No render watchdog threshold logging.
- No hard nomination cap.
- Accept any decodable blob image format.
- During processing, reduce image size/quality where possible to limit memory/output pressure.
- Structured info-level logs with fields:
  - `guildId`, `round`, `voteType`, `count`, `durationMs`, `errorCode`
- Sanitize user-facing errors; do not expose stack traces/internal SQL details.
- If Discord attachment upload fails after render, return concise error in deferred reply and log exception.

9. Rollout approach
- PoC only, guild-scoped command.
- Manual validation in target guild/channel.
- Iterate on layout/readability and failure handling before adding persistence/caching/tests.