# RPG_CLUB_RAW_MODAL_SESSIONS table

Persists direct-API modal sessions so submissions can be validated after bot restart.

## Structure

- **Primary/unique constraints:** `SESSION_ID` primary key.
- **Indexes:** `IX_RAW_MODAL_SESS_OWNER_STATUS` on `(OWNER_USER_ID, STATUS)`, `IX_RAW_MODAL_SESS_EXPIRES` on `(EXPIRES_AT)`.
- **Triggers:** `TRG_RAW_MODAL_SESS_UPD` updates `UPDATED_AT`.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| SESSION_ID | VARCHAR2(120) | No | - | Stable modal session identifier in custom ids. |
| OWNER_USER_ID | VARCHAR2(30) | No | - | Discord user id allowed to submit the modal. |
| FEATURE_ID | VARCHAR2(60) | No | - | Feature key such as `todo`. |
| FLOW_ID | VARCHAR2(60) | No | - | Flow key such as `create` or `edit-title`. |
| STATE_JSON | CLOB | No | - | Serialized state payload required to resume processing. |
| STATUS | VARCHAR2(20) | No | `OPEN` | Session lifecycle status: `OPEN`, `SUBMITTED`, `EXPIRED`. |
| EXPIRES_AT | TIMESTAMP WITH TIME ZONE | No | - | Short TTL expiration cutoff. |
| GUILD_ID | VARCHAR2(30) | Yes | - | Optional guild context for recovery and diagnostics. |
| CHANNEL_ID | VARCHAR2(30) | Yes | - | Optional channel context for recovery and diagnostics. |
| CREATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Session create timestamp. |
| UPDATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Auto-updated on row change. |
