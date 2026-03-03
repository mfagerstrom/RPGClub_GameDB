# NR_GOTM_ENTRIES table

Oracle table listing Non-Retro Game of the Month entries and metadata.

## Structure

- **Primary key:** `PK_NR_GOTM_ENTRIES_ID` on `NR_GOTM_ID`.
- **Unique constraints/indexes:** `UX_NR_GOTM_ENTRIES_RND_IDX` on `(ROUND_NUMBER, GAME_INDEX)`.
- **Triggers:** None reported.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| ROUND_NUMBER | NUMBER | No | — | Round identifier; part of unique index. |
| MONTH_YEAR | VARCHAR2(50) | No | — | Month/year label. |
| GAME_INDEX | NUMBER | No | — | Position within the round; part of unique index. |
| GAME_TITLE | VARCHAR2(255) | No | — | Title of the selected game. |
| GAMEDB_GAME_ID | NUMBER | No | — | Foreign key to `GAMEDB.GAMEDB_GAME_ID`; thread links resolve via thread-link tables. |
| REDDIT_URL | VARCHAR2(500) | Yes | — | Reddit post link. |
| VOTING_RESULTS_MESSAGE_ID | VARCHAR2(50) | Yes | — | Discord message id with results. |
| NR_GOTM_ID | NUMBER | No | `"SYSTEM"."ISEQ$$_72464".nextval` | Primary key. |
| IMAGE_BLOB | BLOB | Yes | — | Stored image bytes. |
| IMAGE_MIME_TYPE | VARCHAR2(128) | Yes | — | MIME type for stored image. |
