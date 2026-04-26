# REST API Spike for Bot Data and Operations

## Status

Proposed for issue #135.

## Decision

A C# ASP.NET Core API can live in this repository temporarily, but it should be
isolated as a separate project and process. The bot should remain the TypeScript
Discord runtime, and the API should not be hosted inside the bot process.

Recommended temporary layout:

```text
api/
  RPGClub.Api/
    RPGClub.Api.csproj
    Program.cs
    Endpoints/
    Auth/
    Data/
    Contracts/
  RPGClub.Api.Tests/
docs/
  decisions/
```

This gives the project a monorepo phase while keeping a clean extraction path if
the API later moves to its own repository. Shared database access should be
shared through the Oracle schema and documented contracts, not by calling bot
classes or importing TypeScript internals.

## Context

The current system is primarily Discord-command driven. Existing database docs
cover GameDB, profiles, completions, suggestions, todos, GOTM, NR-GOTM, and
nomination data under `db/`. A future website or external client needs a stable
HTTP contract instead of direct coupling to Discord command handlers.

Current bot implementation constraints that matter for the API:

- Discord IDs are snowflakes and must remain strings in API contracts.
- Role data already exists on `RPG_CLUB_USERS` as role flags.
- Some current Discord workflows keep interaction state in memory. API writes
  should not depend on those flows and should be restart-safe by default.
- `build/` remains bot output only and must not be used for API source.

Reference practices used for this spike:

- ASP.NET Core supports authentication and authorization middleware for API
  protection:
  https://learn.microsoft.com/en-us/aspnet/core/security/authentication/
- ASP.NET Core has built-in rate limiting middleware with endpoint policies:
  https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit
- ASP.NET Core supports RFC 7807 problem details for API errors:
  https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling-api
- ASP.NET Core supports health checks for service monitoring:
  https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks
- ASP.NET Core has built-in OpenAPI document generation support:
  https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/overview
- Discord.js v14 currently documents Node.js 22.12.0 or newer for latest usage:
  https://discord.js.org/docs/packages/discord.js/main
- DiscordX documents decorators and guards for slash commands, components, and
  event handling:
  https://discordx.js.org/docs/discordx/decorators/

## Candidate API Domains

The MVP should start read-heavy and expose stable contracts around data already
used by bot commands.

### Profiles

- `GET /api/v1/profiles`
- `GET /api/v1/profiles/{userId}`
- `PATCH /api/v1/profiles/{userId}`
- `GET /api/v1/profiles/{userId}/activity-icons`

Initial fields should include Discord profile data, role flags, platform links,
message count, join and last seen timestamps, and donor notification preference.
Avatar and generated profile image bytes should be separate media endpoints or
signed URLs, not inline base64 in normal profile responses.

### Now Playing

- `GET /api/v1/now-playing`
- `GET /api/v1/profiles/{userId}/now-playing`
- `PUT /api/v1/profiles/{userId}/now-playing/{gameId}`
- `DELETE /api/v1/profiles/{userId}/now-playing/{gameId}`

This domain should reflect user game collection and presence prompt data without
reusing Discord interaction sessions.

### Completions

- `GET /api/v1/completions`
- `GET /api/v1/profiles/{userId}/completions`
- `POST /api/v1/profiles/{userId}/completions`
- `PATCH /api/v1/profiles/{userId}/completions/{completionId}`
- `DELETE /api/v1/profiles/{userId}/completions/{completionId}`

Writes need duplicate detection compatible with the bot behavior, including
same-game completions close together in time.

### Monthly Games

- `GET /api/v1/monthly-games/gotm/rounds`
- `GET /api/v1/monthly-games/gotm/rounds/{roundNumber}`
- `GET /api/v1/monthly-games/nr-gotm/rounds`
- `GET /api/v1/monthly-games/nr-gotm/rounds/{roundNumber}`
- `GET /api/v1/monthly-games/{kind}/nominations`
- `POST /api/v1/monthly-games/{kind}/nominations`
- `DELETE /api/v1/monthly-games/{kind}/nominations/{nominationId}`

Use `kind` values `gotm` and `nr-gotm`. Nomination writes must enforce one active
nomination per user per round and the same reason length as the database.

### Suggestions

- `GET /api/v1/suggestions`
- `POST /api/v1/suggestions`
- `PATCH /api/v1/suggestions/{suggestionId}`
- `POST /api/v1/suggestions/{suggestionId}/github-sync`

The GitHub sync endpoint should be admin-only and idempotent.

### Todos

- `GET /api/v1/todos`
- `POST /api/v1/todos`
- `PATCH /api/v1/todos/{todoId}`
- `POST /api/v1/todos/{todoId}/complete`
- `POST /api/v1/todos/{todoId}/reopen`

Todo writes should be limited to maintainers or service integrations.

### GameDB Search and Lookup

- `GET /api/v1/games`
- `GET /api/v1/games/{gameId}`
- `GET /api/v1/games/{gameId}/releases`
- `GET /api/v1/games/{gameId}/platforms`

GameDB write endpoints should wait until the read contract is proven stable.

## Authentication and Authorization

Use layered authentication so the same API can serve the bot, an admin website,
and future integrations.

### Service Tokens

Use API keys or signed JWT client credentials for service-to-service calls from
the bot and trusted jobs.

Recommended for MVP:

- Store token hashes server-side.
- Require `Authorization: Bearer <token>`.
- Assign token scopes such as `profiles:read`, `completions:write`,
  `todos:write`, and `admin`.
- Rotate tokens without redeploying.
- Audit every write with token identity.

### User Auth

Use Discord OAuth2 for website users when browser-based clients are introduced.
Map the Discord user id from OAuth to `RPG_CLUB_USERS.USER_ID`.

Recommended claims:

- `sub`: Discord user id.
- `roles`: derived from `ROLE_ADMIN`, `ROLE_MODERATOR`, `ROLE_REGULAR`,
  `ROLE_MEMBER`, and `ROLE_NEWCOMER`.
- `scopes`: user-granted API permissions.

### Role-Based Access

Apply role and ownership rules per endpoint:

- Public read: selected GameDB, monthly games, and public leaderboard data.
- Owner read and write: a user's own profile links, now-playing, completions,
  and nominations.
- Moderator or admin write: moderation workflows, suggestion review, and todo
  management.
- Service-only write: internal sync jobs and bot-initiated automation.

## Data and Response Standards

Use JSON with `camelCase` property names. All timestamps should be ISO 8601 UTC
strings. Discord IDs should be strings. Oracle numeric IDs can be numbers unless
they can exceed JavaScript safe integer limits, in which case they should be
strings.

List response shape:

```json
{
  "items": [],
  "page": {
    "limit": 50,
    "nextCursor": null
  }
}
```

Default list behavior:

- `limit` defaults to 50 and has a maximum of 100.
- Prefer cursor pagination for changing datasets.
- Use offset pagination only for small admin-only lists where stable ordering is
  clear.
- Every list endpoint must define its default sort order.

Filtering standards:

- Use query parameters, for example `?userId=...&year=2026&kind=gotm`.
- Validate enums explicitly.
- Reject ambiguous filters instead of silently guessing.

Error standards:

- Use RFC 7807 problem details.
- Include a stable `type`, human-readable `title`, HTTP `status`, short
  `detail`, and request `traceId`.
- Validation errors should include an `errors` object keyed by request field.
- Do not expose SQL, stack traces, connection strings, or Discord tokens.

Versioning:

- Start with URL versioning under `/api/v1`.
- Generate OpenAPI for each deployed version.
- Do not break `v1` response fields after public use. Add fields instead.
- Deprecate with response headers and release notes before removal.

## Write Safety

Every write endpoint should have the following safeguards:

- Request DTO validation before database access.
- Authorization check before mutation.
- Idempotency support for externally retried creates with an
  `Idempotency-Key` header.
- Rate limiting partitioned by user id, service token id, and fallback IP.
- Audit logging with actor, action, target, request trace id, before and after
  summary where practical, and outcome.
- Optimistic concurrency for edit-heavy resources using `updatedAt` or an ETag.
- Transactions around multi-table updates.
- Clear separation between data writes and Discord side effects.

Discord side effects should be event-driven after the database commit. For
example, a completion create can enqueue an announcement request instead of
directly sending a Discord message from the API request thread.

## Operational Concerns

Hosting model:

- Run the API as a separate ASP.NET Core process, not inside the bot.
- In the temporary monorepo phase, build and deploy it from `api/RPGClub.Api`.
- Use separate configuration keys for API secrets, Oracle pool sizing, CORS, and
  allowed origins.
- Keep bot and API deployable independently.

Database access:

- Use `Oracle.ManagedDataAccess.Core` for Oracle connectivity.
- Keep SQL in repository-owned data access classes or query files.
- Do not make the C# API call TypeScript bot code.
- Start with read replicas only if the Oracle hosting model supports them.

Scaling expectations:

- Initial traffic should be low, mostly internal bot and maintainer website use.
- The main risk is database connection pressure, not CPU.
- Configure a small Oracle pool for the API so it cannot starve the bot.
- Add endpoint-level caching for public read-heavy data such as GameDB lookup and
  monthly game history.

Monitoring:

- Provide `/health/live` and `/health/ready`.
- Readiness must check Oracle connectivity.
- Emit structured logs with trace ids.
- Track request duration, status code counts, rate limit rejections, auth
  failures, DB pool usage, and write failures.

Uptime impact:

- The API must fail independently from the bot where possible.
- Bot commands should continue working if the API is offline during the
  temporary co-location phase.
- Shared database migrations must remain backward compatible until both bot and
  API versions support the new shape.

## Recommended Implementation Path

### Phase 0: Repository and Contract Setup

- Create `api/RPGClub.Api` and `api/RPGClub.Api.Tests`.
- Add OpenAPI generation.
- Add health checks, problem details, structured logging, and configuration
  validation.
- Add service-token auth with scopes.
- Add a small database connection abstraction.

### Phase 1: Read-Only MVP

- Profiles read endpoints.
- GameDB lookup and search endpoints.
- GOTM and NR-GOTM history endpoints.
- Completions list endpoints.
- OpenAPI published as an artifact.

This phase proves contracts, Oracle pool sizing, hosting, and website use without
changing bot behavior.

### Phase 2: Low-Risk Writes

- User-owned profile link updates.
- User-owned now-playing updates.
- Suggestions create.
- Todo writes only for maintainer tokens.
- Add audit logging before enabling general user writes.

### Phase 3: Higher-Risk Domain Writes

- Completion create, edit, and delete.
- GOTM and NR-GOTM nominations.
- Event queue or outbox for Discord announcements.
- Admin review workflows.

### Phase 4: Extraction Decision

Decide whether to keep a monorepo or move the API to a dedicated repo. Extract
when build pipelines, release cadence, or ownership diverge enough that the bot
repo becomes noisy.

## Risks and Dependencies

Risks:

- Divergence between bot validation and API validation.
- Oracle connection pool contention.
- Discord role data becoming stale for website authorization.
- Write endpoints causing Discord side effects twice during retries.
- CORS and token exposure mistakes once a browser client exists.
- Mixed TypeScript and .NET tooling increasing local setup complexity.

Dependencies:

- Stable Oracle connection configuration for the API.
- A token storage and rotation plan.
- Agreement on Discord OAuth2 application ownership.
- Audit log table or shared audit pattern.
- Deployment target for a long-running ASP.NET Core service.
- Clear rule for whether API writes should notify Discord.

## Out of Scope

- Production implementation of the C# API.
- Website UI implementation.
- Full Discord OAuth2 login flow.
- Replacing Discord commands with API calls.
- Moving the bot to C#.
- Public third-party API onboarding.
- Long-term repository split.
- Database schema changes beyond audit or idempotency support.

## Open Questions

- Which host should run the ASP.NET Core process during the temporary phase?
- Should service tokens live in Oracle, a secrets manager, or both?
- Should Discord role authorization trust cached `RPG_CLUB_USERS` flags, perform
  live Discord checks, or use a hybrid?
- Which writes should trigger Discord announcements?
- Do we need an outbox table before any write endpoints go live?
- What CORS origins should be allowed for the first website client?
- Should the API support public unauthenticated reads, or require auth for all
  endpoints until abuse patterns are understood?
- How should generated OpenAPI be published for consumers?
- Is a dedicated audit table acceptable, or should existing history tables be
  extended per domain?

## Recommendation

Keep the C# API in this repo temporarily only if it is isolated under `api/`,
deployed as its own process, and prevented from depending on TypeScript bot
internals. Start with a read-only MVP, then add audited and rate-limited writes
after the contract and hosting model are proven.
