# RPG_CLUB_ADMIN_WIZARD_SESSIONS table

Persists admin command wizard session state so flows can resume after bot restart.

## Structure

- **Primary key:** `PK_RPG_CLUB_ADMIN_WIZARD_SESS` on `SESSION_ID`.
- **Unique constraints/indexes:** `UX_RPG_CLUB_ADMIN_WIZ_ACTIVE` on
  `(COMMAND_KEY, OWNER_USER_ID, CHANNEL_ID, STATUS)`.
- **Indexes:** `IX_RPG_CLUB_ADMIN_WIZ_OWNER_STATUS` on
  `(OWNER_USER_ID, STATUS, LAST_UPDATED_AT)`.
- **Triggers:** `TRG_RPG_CLUB_ADMIN_WIZ_SESS_UPD` updates `UPDATED_AT` on row updates.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| SESSION_ID | VARCHAR2(200) | No | — | Stable wizard session identifier. |
| COMMAND_KEY | VARCHAR2(80) | No | — | Admin command key, for example `nextround-setup`. |
| OWNER_USER_ID | VARCHAR2(64) | No | — | Discord user id for the admin running the wizard. |
| CHANNEL_ID | VARCHAR2(64) | No | — | Discord channel id where the wizard is running. |
| GUILD_ID | VARCHAR2(64) | Yes | — | Discord guild id context when available. |
| STATUS | VARCHAR2(20) | No | `ACTIVE` | Session lifecycle status (`ACTIVE`, `COMPLETED`, `CANCELLED`). |
| STATE_JSON | CLOB | No | — | Serialized wizard state payload (step, selections, ordering, vote date, test mode). |
| LAST_UPDATED_AT | TIMESTAMP(6) | No | CURRENT_TIMESTAMP | Last logical state update timestamp used for resume ordering. |
| CREATED_AT | TIMESTAMP(6) | No | CURRENT_TIMESTAMP | Row creation timestamp. |
| UPDATED_AT | TIMESTAMP(6) | No | CURRENT_TIMESTAMP | Row update timestamp maintained by trigger. |
