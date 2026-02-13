import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import eslintConfigPrettier from "eslint-config-prettier";
import localRules from "./eslint-rules/index.js";

export default [
  { ignores: ["build/**"] },
  eslintConfigPrettier,
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts}"],
    ignores: ["**/*.config.{ts}", "*.reference.ts"],
    plugins: {
      "@stylistic": stylistic,
      local: localRules,
    },
    rules: {
      // all interfaces should be named starting with a capital I (ie. IUser, IAgency)
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "interface",
          format: ["PascalCase"],
          custom: {
            regex: "^I[A-Z]",
            match: true,
          },
        },
      ],

      // turn off default rule - allow arrays/objects to be initialized empty ([], {})
      "@typescript-eslint/no-empty-interface": 0,
      "@typescript-eslint/typedef": 0,
      "@typescript-eslint/no-explicit-any": "off",

      // enforce proper spacing in comments
      "spaced-comment": ["error", "always", {
        line: {
          markers: ["/"],
        },
        block: {
          markers: ["!"],
          exceptions: ["*"],
          balanced: true,
        },
      }],

      // enforce trailing commas in object an object and array literals, function parameters, 
      // and other syntactic structures -- when they are each on their own line
      "comma-dangle": ["error", "always-multiline"],

      // enforce readability by limiting lines to 100 characters
      "max-len": ["error", {
        code: 100,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreComments: true,
      }],

      // enforce semicolons at the end of statements
      semi: "error",

      // enforce only one blank line in a row
      "no-multiple-empty-lines": ["error", { max: 1 }],

      // bans the use of playwright's page.goto and page.waitForURL functions,
      // in favor of our own implementation of each page object's gotoAndCheckUrl function
      "no-restricted-properties": [2, {
        property: "goto",
        message: "Please use gotoAndCheckUrl instead of page.goto",
      }, {
        property: "waitForURL",
        message: "Please use gotoAndCheckUrl instead of page.waitForURL",
      }],
      "local/no-djs-button-in-v2-accessory": "error",
      "local/prefer-safe-interaction-methods": "warn",
      "local/no-deprecated-interaction-options": "error",
      "local/no-silent-interaction-update-catch": "error",
      "local/no-edit-reply-on-modal-union": "error",
      "local/require-relative-import-js-extension": "error",
      "local/slash-options-required-first": "error",
      "local/no-unused-imports-vars-local": "error",
      "local/no-build-folder-edits": "error",
      "local/attachment-builder-asset-path": "error",
      "local/no-emdash": "error",
      "local/channel-id-constants-in-channels-config": "error",
      "local/user-id-constants-in-users-config": "error",
      "local/tag-id-constants-in-tags-config": "error",
      "local/message-flag-id-constants-in-tags-config": "error",
      "local/stable-custom-id": "error",
      "local/no-duplicate-literal-custom-id-in-block": "error",
      "local/components-v2-structure": "error",
      "local/no-components-v2-with-content": "error",
      "local/require-components-v2-flag-with-v2-components": "error",
      "local/dynamic-components-require-chunking": "error",
      "local/custom-id-has-matching-handler": "error",
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
