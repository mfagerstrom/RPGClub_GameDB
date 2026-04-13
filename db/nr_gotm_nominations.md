# NR_GOTM_NOMINATIONS table

Oracle table storing Non-Retro Game of the Month nominations by round and user.

## Structure

- **Primary key:** `PK_NR_GOTM_NOMINATIONS` on `NOMINATION_ID`.
- **Unique constraints/indexes:** `UX_NR_GOTM_NOMS_ROUND_USER` on `(ROUND_NUMBER, USER_ID)`
  to prevent duplicate nominations per user per round.
- **Indexes:** `IX_NR_GOTM_NOMS_ROUND` on `ROUND_NUMBER` and
  `IX_NR_GOTM_NOMS_GAMEDB` on `GAMEDB_GAME_ID`.
- **Triggers:** None reported.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| NOMINATION_ID | NUMBER | No | `"SYSTEM"."ISEQ$$_73065".nextval` | Primary key. |
| ROUND_NUMBER | NUMBER | No | — | Round identifier; part of unique constraint. |
| USER_ID | VARCHAR2(64) | No | — | Discord user id; part of unique constraint. |
| GAMEDB_GAME_ID | NUMBER | No | — | Reference to GAMEDB_GAMES.GAME_ID. |
| NOMINATED_AT | TIMESTAMP(6) | No | CURRENT_TIMESTAMP | When the nomination was recorded. |
| REASON | VARCHAR2(1500) | Yes | — | Optional nomination reason. |
