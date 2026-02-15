# RPGClub GameDB Bot

RPGClub GameDB Bot is a Discord bot that powers GameDB lookups, Monthly Games workflows, and member utilities for the RPG Club community. It is built with TypeScript, Discord.js v14, and DiscordX, with an Oracle-backed data model and IGDB integration for game metadata.

## What It Does

- GameDB search, import, and viewing with IGDB data
- GOTM and NR-GOTM history, nominations, and round status
- Member profiles, Now Playing, and game completion tracking with CSV imports
- Personal game collections with Steam imports for collection entries
- Reminders, RSS relays, public reminders, and giveaway tools
- GitHub issue management via bot commands

## Tech Stack

- Node.js with TypeScript and ESM
- Discord.js v14 and DiscordX
- Oracle DB via `oracledb`
- IGDB API integration for metadata
- GitHub App integration for issue workflows

## Command Overview

Use `/help` in Discord for full syntax and parameters. Major command groups include:

- Monthly games: `/gotm`, `/nr-gotm`, `/round`
- GameDB: `/gamedb`, `/collection`, `/now-playing`, `/game-completion`
- Members: `/profile`, `/mp-info`
- Utilities: `/hltb`, `/activity-emoji`, `/remindme`, `/gamegiveaway`, `/avatar-history`
- Admin tools: `/mod`, `/admin`, `/superadmin`, `/todo`, `/publicreminder`, `/thread`, `/rss`, `/suggestion-review`

## Database Docs

Schema and table notes live in `db/`. Review those files when modifying or adding tables.

## Local Development

1. Install dependencies.
2. Provide required environment variables.
3. Run the bot in dev mode.

```bash
npm install
npm run dev
```

The entrypoint is `src/RPGClub_GameDB.ts`, and the compiled output is `build/RPGClub_GameDB.js`.

## Environment Variables

These are required or commonly used by the bot. Values depend on your deployment.

- `BOT_TOKEN`
- `ORACLE_USER`
- `ORACLE_PASSWORD`
- `ORACLE_CONNECT_STRING`
- `ORACLE_POOL_MIN`
- `ORACLE_POOL_MAX`
- `ORACLE_POOL_INCREMENT`
- `ORACLE_POOL_QUEUE_TIMEOUT_MS`
- `ORACLE_POOL_IDLE_TIMEOUT_SECONDS`
- `ORACLE_STMT_CACHE_SIZE`
- `IGDB_CLIENT_ID`
- `IGDB_CLIENT_SECRET`
- `IGDB_SCAN_ENABLED`
- `IGDB_SCAN_INTERVAL_MINUTES`
- `IGDB_SCAN_BATCH_SIZE`
- `IGDB_SCAN_MIN_AGE_DAYS`
- `IGDB_SCAN_THROTTLE_MS`
- `GITHUB_REPO_OWNER`
- `GITHUB_REPO_NAME`
- `GITHUB_APP_ID`
- `GITHUB_APP_INSTALLATION_ID`
- `GITHUB_APP_PRIVATE_KEY`

## Useful Scripts

- `npm run dev` - Run the bot with ts-node.
- `npm run build` - Build the TypeScript output.
- `npm run compile` - Type check without emitting.
- `npm run lint` - Run ESLint.
- `npm run watch` - Run dev mode with file watching.
- `npm run start` - Run compiled output.
- `npm run start:prod` - Run compiled output with pm2.
- `npm run buildProd` - Build and restart or start pm2.
- `npm run import:igdb-platforms` - Sync IGDB platforms into GameDB.
- `npm run script:reimport-releases` - Reimport release data from IGDB.
- `npm run snapshot:url` - Snapshot a URL.
- `npm run session:start` - Run session startup tasks.
- `npm run backup:docker-volumes` - Backup docker volumes.

## Configuration

Discord channel IDs, user IDs, and tags are centralized in `src/config/`. Update those files to match your server.

## Notes

- The bot expects a prebuilt `build/` folder for production runs. Do not delete the `build/` directory.
- Slash command help content is implemented in `src/commands/help.command.ts`.
