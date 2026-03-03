# GOTM_ENTRIES table

Oracle table listing Game of the Month entries and related metadata.

## Structure

- **Primary/unique constraints:** `SYS_C008534` on `GOTM_ID` (primary key); unique index
  `UK_GOTM_ROUND_IDX` on `(ROUND_NUMBER, GAME_INDEX)`.
- **Indexes:** `IX_GOTM_MONTH_YEAR` on `MONTH_YEAR`; `IX_GOTM_ROUND` on `ROUND_NUMBER`;
  `IX_GOTM_TITLE` on `GAME_TITLE`.
- **Triggers:** None reported.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| GOTM_ID | NUMBER | No | `"SYSTEM"."ISEQ$$_72452".nextval` | Primary key. |
| ROUND_NUMBER | NUMBER(5,0) | No | — | Round identifier; part of unique index. |
| MONTH_YEAR | VARCHAR2(200) | No | — | Month/year label (e.g., "2024-09"). |
| GAME_INDEX | NUMBER(3,0) | No | — | Position within the round; part of unique index. |
| GAME_TITLE | VARCHAR2(1020) | No | — | Title of the selected game. |
| GAMEDB_GAME_ID | NUMBER | No | — | Foreign key to `GAMEDB.GAMEDB_GAME_ID`; thread links resolve via thread-link tables. |
| REDDIT_URL | VARCHAR2(2048) | Yes | — | Link to Reddit post for the round. |
| VOTING_RESULTS_MESSAGE_ID | VARCHAR2(200) | Yes | — | Discord message id with voting results. |
| IMAGE_BLOB | BLOB | Yes | — | Stored image bytes for the game. |
| IMAGE_MIME_TYPE | VARCHAR2(128) | Yes | — | MIME type for the stored image. |
