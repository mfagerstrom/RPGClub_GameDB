You may only edit files in the current working directory.
You may only use non-destructive git commands.
name sql files starting with today's date with datestamp (ie 20251210_sql_script_name) YYYYMMDD_name_format
Research best practices for Discord.js and DiscordX, along with Typescript, so your coding mindset isn't out of date
review eslint.config.ts and follow all rules outlined there
Do not delete the build directory.
Table docs live in db folder
Never edit files in the build folder.  They're irrelevant.
Exclude node_modules, build, and package-lock.json from searches unless they are needed for the task.
Prefer targeted searches like `rg -n "thing" src db scripts`.
Avoid reading full large command files when a targeted search or small line range is enough.
Avoid dumping full git diffs unless needed.
Keep temporary debug logs short and focused.
Ask for a plan first when the user wants low-token exploration.
Batch fewer broad tool calls; prefer narrow tool calls with explicit paths.
Aim for clean, centralized patterns (e.g., shared helpers/defaults) instead of duplicating magic numbers or flags across files.
you are not allowed to use emdashes.
Whenever I report an error, assess and report if a custom lint rule would be useful for catching that error in the future.  If a unit test is recommended, let me know as well.
All channel ID constants belong in src/config/channels.ts.
All user ID constants belong in src/config/users.ts.
All tag ID constants belong in src/config/tags.ts.
All message Flag ID constants belong in src/config/tags.ts.
All interactions should use stable identifiers and include the ability to resume after a bot restart.
You are forbidden from using deprecated commands/functions/etc.
You are forbidden from committing code to git or reverting changes without being asked to do so directly.
You are forbidden from reading my .env file.
After completing a task, restate the prompt before your completion message.
