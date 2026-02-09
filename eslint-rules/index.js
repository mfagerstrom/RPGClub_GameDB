const DISCORD_JS_SOURCE = "discord.js";
const INTERACTION_RESPONSE_METHODS = new Set([
  "reply",
  "deferReply",
  "editReply",
  "followUp",
  "update",
]);
const INTERACTION_RESPONSE_HELPERS = new Set([
  "safeReply",
  "safeDeferReply",
  "safeUpdate",
  "safeFollowUp",
]);
const DEPRECATED_RESPONSE_OPTION_KEYS = new Set(["ephemeral", "fetchReply"]);
const INTERACTION_DECORATORS = new Set([
  "ButtonComponent",
  "SelectMenuComponent",
  "ModalComponent",
]);
const SLASH_OPTION_DECORATOR = "SlashOption";
const CHECKED_SET_CUSTOM_ID_BUILDERS = new Set([
  "ButtonBuilder",
  "V2ButtonBuilder",
  "StringSelectMenuBuilder",
  "ModalBuilder",
]);
const RELATIVE_IMPORT_ALLOWED_EXTENSIONS = new Set([".js", ".json", ".mjs", ".cjs"]);
const CHANNEL_ID_SUFFIX = "_CHANNEL_ID";
const USER_ID_SUFFIX = "_USER_ID";
const TAG_ID_SUFFIX = "_TAG_ID";
const MESSAGE_FLAG_ID_SUFFIX = "_MESSAGE_FLAG_ID";
const UNSTABLE_ID_CALLEE_NAMES = new Set(["Date", "Math", "crypto"]);
const UNSTABLE_ID_METHODS = new Set(["now", "random", "randomUUID"]);
const DISALLOWED_TOP_LEVEL_COMPONENT_BUILDERS = new Set([
  "SectionBuilder",
  "TextDisplayBuilder",
  "MediaGalleryBuilder",
  "MediaGalleryItemBuilder",
  "ThumbnailBuilder",
  "SeparatorBuilder",
]);
const COMPONENTS_V2_ROOT_BUILDERS = new Set([
  "ContainerBuilder",
  ...DISALLOWED_TOP_LEVEL_COMPONENT_BUILDERS,
]);
const COMPONENTS_V2_PAYLOAD_FACTORY_NAMES = new Set([
  "buildGameProfileMessagePayload",
]);
const MESSAGE_SEND_METHODS = new Set(["send"]);
const ASSET_PATH_HELPER_NAME = "resolveAssetPath";
const ATTACHMENT_BUILDER_NAME = "AttachmentBuilder";

function isRelativeImportPath(value) {
  return typeof value === "string" && value.startsWith(".");
}

function getImportPathExtension(value) {
  if (typeof value !== "string") return null;
  const lastSlash = value.lastIndexOf("/");
  const lastSegment = lastSlash >= 0 ? value.slice(lastSlash + 1) : value;
  if (!lastSegment || !lastSegment.includes(".")) return null;
  const lastDot = lastSegment.lastIndexOf(".");
  if (lastDot <= 0) return null;
  return lastSegment.slice(lastDot);
}

function hasAllowedRelativeImportExtension(value) {
  const ext = getImportPathExtension(value);
  return ext ? RELATIVE_IMPORT_ALLOWED_EXTENSIONS.has(ext) : false;
}

function getLiteralString(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  return null;
}

function getNearestBlockScopeKey(node) {
  let current = node?.parent ?? null;
  while (current) {
    if (current.type === "BlockStatement" || current.type === "Program") {
      const start = current.range?.[0] ?? 0;
      const end = current.range?.[1] ?? 0;
      return `${start}:${end}`;
    }
    current = current.parent ?? null;
  }
  return "global";
}

function collectStaticStringConstants(program) {
  const map = new Map();
  for (const node of program.body) {
    if (node.type !== "VariableDeclaration" || node.kind !== "const") continue;
    for (const declarator of node.declarations) {
      if (declarator.type !== "VariableDeclarator") continue;
      if (!declarator.id || declarator.id.type !== "Identifier") continue;
      const value = resolveStaticStringExpression(declarator.init, map);
      if (typeof value === "string") {
        map.set(declarator.id.name, value);
      }
    }
  }
  return map;
}

function resolveStaticStringExpression(node, constantMap) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "Identifier") {
    return constantMap.get(node.name) ?? null;
  }
  if (node.type === "TemplateLiteral") {
    if (node.expressions.length === 0) {
      return node.quasis[0]?.value?.cooked ?? node.quasis[0]?.value?.raw ?? "";
    }
    let output = "";
    for (let i = 0; i < node.quasis.length; i += 1) {
      output += node.quasis[i]?.value?.cooked ?? node.quasis[i]?.value?.raw ?? "";
      if (i >= node.expressions.length) continue;
      const exprValue = resolveStaticStringExpression(node.expressions[i], constantMap);
      if (typeof exprValue !== "string") return null;
      output += exprValue;
    }
    return output;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = resolveStaticStringExpression(node.left, constantMap);
    const right = resolveStaticStringExpression(node.right, constantMap);
    if (typeof left === "string" && typeof right === "string") {
      return `${left}${right}`;
    }
  }
  return null;
}

function extractResolvablePrefix(node, constantMap) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "Identifier") {
    return constantMap.get(node.name) ?? null;
  }
  if (node.type === "TemplateLiteral") {
    let output = "";
    for (let i = 0; i < node.quasis.length; i += 1) {
      output += node.quasis[i]?.value?.cooked ?? node.quasis[i]?.value?.raw ?? "";
      if (i >= node.expressions.length) continue;
      const expr = node.expressions[i];
      const exprValue = resolveStaticStringExpression(expr, constantMap);
      if (typeof exprValue !== "string") {
        return output.length ? output : null;
      }
      output += exprValue;
    }
    return output;
  }
  const staticString = resolveStaticStringExpression(node, constantMap);
  return typeof staticString === "string" ? staticString : null;
}

function extractRegexPrefix(pattern) {
  if (typeof pattern !== "string" || !pattern.startsWith("^")) {
    return null;
  }

  let prefix = "";
  for (let i = 1; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "\\") {
      const next = pattern[i + 1];
      if (!next) break;
      if (/^[dDsSwWbB]$/.test(next)) break;
      prefix += next;
      i += 1;
      continue;
    }
    if (/^[A-Za-z0-9:_-]$/.test(char)) {
      prefix += char;
      continue;
    }
    break;
  }
  return prefix || null;
}

function getDecoratorIdentifierName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "CallExpression" && node.callee.type === "Identifier") {
    return node.callee.name;
  }
  return null;
}

function getDecoratorIdValueArg(decoratorExpression) {
  if (!decoratorExpression || decoratorExpression.type !== "CallExpression") {
    return null;
  }
  const firstArg = decoratorExpression.arguments[0];
  if (!firstArg || firstArg.type !== "ObjectExpression") return null;
  for (const prop of firstArg.properties) {
    if (!prop || prop.type !== "Property") continue;
    const keyName = getPropertyName(prop.key);
    if (keyName === "id") {
      return prop.value;
    }
  }
  return null;
}

function getDecoratorOptionsArg(decoratorExpression) {
  if (!decoratorExpression || decoratorExpression.type !== "CallExpression") {
    return null;
  }
  const firstArg = decoratorExpression.arguments[0];
  if (!firstArg || firstArg.type !== "ObjectExpression") return null;
  return firstArg;
}

function getObjectPropertyValue(objectNode, key) {
  if (!objectNode || objectNode.type !== "ObjectExpression") return null;
  for (const prop of objectNode.properties) {
    if (!prop || prop.type !== "Property") continue;
    const keyName = getPropertyName(prop.key);
    if (keyName === key) return prop.value;
  }
  return null;
}

function isAllowedIdConstantLocation(filename, suffix) {
  if (!filename) return false;
  if (suffix === CHANNEL_ID_SUFFIX) return filename.endsWith("/src/config/channels.ts");
  if (suffix === USER_ID_SUFFIX) return filename.endsWith("/src/config/users.ts");
  if (suffix === TAG_ID_SUFFIX || suffix === MESSAGE_FLAG_ID_SUFFIX) {
    return filename.endsWith("/src/config/tags.ts");
  }
  return false;
}

function isLiteralIdString(node) {
  return Boolean(node && node.type === "Literal" && typeof node.value === "string");
}

function isNumericIdString(node) {
  return isLiteralIdString(node) && /^\d+$/.test(node.value);
}

function containsUnstableExpression(node) {
  if (!node) return false;
  const nodes = [node];
  while (nodes.length) {
    const current = nodes.pop();
    if (!current) continue;

    if (current.type === "CallExpression") {
      const callee = current.callee;
      if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
        const objectName = callee.object.type === "Identifier"
          ? callee.object.name
          : null;
        const methodName = callee.property.name;
        if (objectName && UNSTABLE_ID_CALLEE_NAMES.has(objectName)) {
          if (UNSTABLE_ID_METHODS.has(methodName)) return true;
        }
      }
      if (callee.type === "Identifier" && UNSTABLE_ID_METHODS.has(callee.name)) {
        return true;
      }
    }

    if (current.type === "NewExpression") {
      if (current.callee.type === "Identifier" && current.callee.name === "Date") {
        return true;
      }
    }

    for (const key of Object.keys(current)) {
      const value = current[key];
      if (!value) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item.type === "string") nodes.push(item);
        }
      } else if (value && typeof value.type === "string") {
        nodes.push(value);
      }
    }
  }
  return false;
}

function shouldIgnoreUnusedVariable(variable) {
  if (!variable || !variable.identifiers?.length) return true;
  const name = variable.identifiers[0]?.name ?? "";
  return name.startsWith("_");
}

function collectUnusedVariables(scope, unused) {
  for (const variable of scope.variables) {
    if (shouldIgnoreUnusedVariable(variable)) continue;
    const isImport = variable.defs.some((def) => def.type === "ImportBinding");
    const isVariable = variable.defs.some((def) => def.type === "Variable");
    if (!isImport && !isVariable) continue;
    if (variable.references.length === 0) {
      unused.push(variable);
    }
  }
  for (const child of scope.childScopes) {
    collectUnusedVariables(child, unused);
  }
}

function getDecoratorKind(name) {
  if (name === "ButtonComponent") return "button";
  if (name === "SelectMenuComponent") return "select";
  if (name === "ModalComponent") return "modal";
  return null;
}

function getBuilderRootName(node) {
  let current = node;
  while (current && current.type === "CallExpression") {
    if (current.callee.type !== "MemberExpression") break;
    current = current.callee.object;
  }

  if (current?.type === "NewExpression") {
    if (current.callee.type === "Identifier") {
      return current.callee.name;
    }
    if (
      current.callee.type === "MemberExpression" &&
      current.callee.property.type === "Identifier"
    ) {
      return current.callee.property.name;
    }
  }
  return null;
}

function getInteractionKindForBuilder(rootName) {
  if (!rootName || !CHECKED_SET_CUSTOM_ID_BUILDERS.has(rootName)) {
    return null;
  }
  if (rootName === "StringSelectMenuBuilder") return "select";
  if (rootName === "ModalBuilder") return "modal";
  return "button";
}

function getDiscordJsButtonBuilderNames(program) {
  const localNames = new Set();
  for (const node of program.body) {
    if (node.type !== "ImportDeclaration") continue;
    if (node.source.value !== DISCORD_JS_SOURCE) continue;
    for (const spec of node.specifiers) {
      if (spec.type !== "ImportSpecifier") continue;
      if (spec.imported.name === "ButtonBuilder") {
        localNames.add(spec.local.name);
      }
    }
  }
  return localNames;
}

function getPropertyName(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return null;
}

function getCalleePropertyName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && node.property.type === "Identifier") {
    return node.property.name;
  }
  return null;
}

function getCalledFunctionName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && node.property.type === "Identifier") {
    return node.property.name;
  }
  return null;
}

function getTypeReferenceName(node) {
  if (!node || node.type !== "TSTypeReference") return null;
  const typeName = node.typeName;
  if (!typeName) return null;
  if (typeName.type === "Identifier") return typeName.name;
  if (typeName.type === "TSQualifiedName") {
    if (typeName.right?.type === "Identifier") return typeName.right.name;
  }
  return null;
}

function getIdentifierNameFromParam(paramNode) {
  if (!paramNode) return null;
  if (paramNode.type === "Identifier") return paramNode.name;
  if (paramNode.type === "AssignmentPattern" && paramNode.left.type === "Identifier") {
    return paramNode.left.name;
  }
  return null;
}

function getTypeAnnotationNode(paramNode) {
  if (!paramNode) return null;
  if (paramNode.type === "Identifier") return paramNode.typeAnnotation?.typeAnnotation ?? null;
  if (paramNode.type === "AssignmentPattern" && paramNode.left.type === "Identifier") {
    return paramNode.left.typeAnnotation?.typeAnnotation ?? null;
  }
  return null;
}

function isModalSubmitUnionType(typeAnnotationNode) {
  if (!typeAnnotationNode || typeAnnotationNode.type !== "TSUnionType") {
    return false;
  }

  let hasModal = false;
  let hasOther = false;

  for (const typeNode of typeAnnotationNode.types ?? []) {
    const refName = getTypeReferenceName(typeNode);
    if (refName === "ModalSubmitInteraction") {
      hasModal = true;
      continue;
    }
    hasOther = true;
  }

  return hasModal && hasOther;
}

function unwrapAwaitExpression(node) {
  if (!node) return null;
  if (node.type === "AwaitExpression") return node.argument;
  return node;
}

function normalizePathText(text) {
  if (typeof text !== "string") return "";
  return text.replace(/\\/g, "/").toLowerCase();
}

function resolveAttachmentPathExpression(node, urlPathMap) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value?.cooked ?? node.quasis[0]?.value?.raw ?? "";
  }
  if (node.type === "Identifier") {
    return urlPathMap.get(node.name) ?? null;
  }
  if (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "fileURLToPath"
  ) {
    const [firstArg] = node.arguments;
    if (
      firstArg &&
      firstArg.type === "NewExpression" &&
      firstArg.callee.type === "Identifier" &&
      firstArg.callee.name === "URL"
    ) {
      const [urlArg] = firstArg.arguments;
      if (urlArg && urlArg.type === "Literal" && typeof urlArg.value === "string") {
        return urlArg.value;
      }
    }
  }
  return null;
}

function isResolveAssetPathCall(node) {
  if (!node || node.type !== "CallExpression") return false;
  if (node.callee.type === "Identifier" && node.callee.name === ASSET_PATH_HELPER_NAME) {
    return true;
  }
  if (
    node.callee.type === "MemberExpression" &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === ASSET_PATH_HELPER_NAME
  ) {
    return true;
  }
  return false;
}

function getEnclosingFunctionName(node) {
  let current = node?.parent ?? null;
  while (current) {
    if (current.type === "FunctionDeclaration" && current.id?.type === "Identifier") {
      return current.id.name;
    }
    if (
      current.type === "FunctionExpression" &&
      current.id?.type === "Identifier"
    ) {
      return current.id.name;
    }
    if (current.type === "ArrowFunctionExpression") {
      const parent = current.parent;
      if (
        parent &&
        parent.type === "VariableDeclarator" &&
        parent.id?.type === "Identifier"
      ) {
        return parent.id.name;
      }
    }
    current = current.parent ?? null;
  }
  return null;
}

export default {
  rules: {
    "no-djs-button-in-v2-accessory": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow discord.js ButtonBuilder in Components v2 SectionBuilder button accessories.",
        },
        schema: [],
        messages: {
          discordJsButton:
            "Use the Components v2 ButtonBuilder from @discordjs/builders for SectionBuilder.",
        },
      },
      create(context) {
        let discordJsButtonNames = new Set();
        return {
          Program(node) {
            discordJsButtonNames = getDiscordJsButtonBuilderNames(node);
          },
          CallExpression(node) {
            if (discordJsButtonNames.size === 0) return;
            const callee = node.callee;
            if (
              callee.type !== "MemberExpression" ||
              callee.property.type !== "Identifier" ||
              callee.property.name !== "setButtonAccessory"
            ) {
              return;
            }
            const [arg] = node.arguments;
            if (!arg) return;
            if (arg.type === "NewExpression" && arg.callee.type === "Identifier") {
              if (discordJsButtonNames.has(arg.callee.name)) {
                context.report({ node: arg, messageId: "discordJsButton" });
              }
              return;
            }
            if (arg.type === "Identifier" && discordJsButtonNames.has(arg.name)) {
              context.report({ node: arg, messageId: "discordJsButton" });
            }
          },
        };
      },
    },
    "no-deprecated-interaction-options": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow deprecated interaction response options and fetchReply usage.",
        },
        schema: [],
        messages: {
          deprecatedOption:
            "Use flags or withResponse instead of deprecated interaction response options.",
          deprecatedFetchReply:
            "Do not call fetchReply directly; use withResponse or fetch after replying.",
        },
      },
      create(context) {
        const reportOption = (propNode, key) => {
          // Offer an autofix when the deprecated `ephemeral` property is a boolean literal.
          if (propNode && propNode.type === "Property") {
            const valueNode = propNode.value;
            context.report({
              node: propNode.key,
              messageId: "deprecatedOption",
              data: { key },
              fix: (fixer) => {
                try {
                  if (valueNode && valueNode.type === "Literal") {
                    if (valueNode.value === true) {
                      // Replace `ephemeral: true` with `flags: MessageFlags.Ephemeral`
                      return fixer.replaceText(propNode, "flags: MessageFlags.Ephemeral");
                    }
                    if (valueNode.value === false) {
                      // Remove the property entirely. Try to remove trailing comma if present.
                      return fixer.remove(propNode);
                    }
                  }
                } catch {
                  // fallthrough to no-fix
                }
                return null;
              },
            });
            return;
          }

          context.report({
            node: propNode,
            messageId: "deprecatedOption",
            data: { key },
          });
        };

        const checkOptionsObject = (node) => {
          if (!node || node.type !== "ObjectExpression") return;
          for (const prop of node.properties) {
            if (prop.type !== "Property") continue;
            const keyName = getPropertyName(prop.key);
            if (!keyName || !DEPRECATED_RESPONSE_OPTION_KEYS.has(keyName)) continue;
            reportOption(prop.key, keyName);
          }
        };

        return {
          CallExpression(node) {
            const calleeName = getCalleePropertyName(node.callee);
            if (!calleeName) return;
            const isMethodCall =
              node.callee.type === "MemberExpression" &&
              INTERACTION_RESPONSE_METHODS.has(calleeName);
            const isHelperCall =
              node.callee.type === "Identifier" &&
              INTERACTION_RESPONSE_HELPERS.has(calleeName);
            if (!isMethodCall && !isHelperCall) return;
            checkOptionsObject(node.arguments[0]);
          },
          MemberExpression(node) {
            if (node.property.type !== "Identifier") return;
            if (node.property.name !== "fetchReply") return;
            context.report({ node: node.property, messageId: "deprecatedFetchReply" });
          },
        };
      },
    },
    "no-silent-interaction-update-catch": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow silent catch handlers on interaction.update calls.",
        },
        schema: [],
        messages: {
          silentUpdateCatch:
            "Do not silently catch interaction.update failures. Use safeUpdate(...) or add deferUpdate fallback.",
        },
      },
      create(context) {
        const isEmptyCatchHandler = (node) => {
          if (!node) return true;
          if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") {
            if (node.body.type !== "BlockStatement") {
              return false;
            }
            return node.body.body.length === 0;
          }
          return false;
        };

        const isUpdateCall = (node) => {
          if (!node || node.type !== "CallExpression") return false;
          return getCalleePropertyName(node.callee) === "update";
        };

        return {
          CallExpression(node) {
            if (
              node.callee.type !== "MemberExpression" ||
              node.callee.property.type !== "Identifier" ||
              node.callee.property.name !== "catch"
            ) {
              return;
            }

            if (!isUpdateCall(node.callee.object)) return;
            const [handler] = node.arguments;
            if (!isEmptyCatchHandler(handler)) return;
            context.report({ node, messageId: "silentUpdateCatch" });
          },
        };
      },
    },
    "no-edit-reply-on-modal-union": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow direct editReply calls on union-typed interaction params that include ModalSubmitInteraction.",
        },
        schema: [],
        messages: {
          noEditReply:
            "Do not call {{param}}.editReply directly when {{param}} is a union including ModalSubmitInteraction. Use safeUpdate/safeReply branching instead.",
        },
      },
      create(context) {
        const functionParamStack = [];

        const enterFunction = (node) => {
          const disallowedParams = new Set();
          for (const param of node.params ?? []) {
            const paramName = getIdentifierNameFromParam(param);
            if (!paramName) continue;
            const typeNode = getTypeAnnotationNode(param);
            if (!isModalSubmitUnionType(typeNode)) continue;
            disallowedParams.add(paramName);
          }
          functionParamStack.push(disallowedParams);
        };

        const exitFunction = () => {
          functionParamStack.pop();
        };

        return {
          FunctionDeclaration: enterFunction,
          "FunctionDeclaration:exit": exitFunction,
          FunctionExpression: enterFunction,
          "FunctionExpression:exit": exitFunction,
          ArrowFunctionExpression: enterFunction,
          "ArrowFunctionExpression:exit": exitFunction,
          CallExpression(node) {
            const current = functionParamStack[functionParamStack.length - 1];
            if (!current || current.size === 0) return;
            if (!node.callee || node.callee.type !== "MemberExpression") return;
            if (node.callee.object.type !== "Identifier") return;
            if (node.callee.property.type !== "Identifier") return;
            if (node.callee.property.name !== "editReply") return;
            const objectName = node.callee.object.name;
            if (!current.has(objectName)) return;

            context.report({
              node: node.callee.property,
              messageId: "noEditReply",
              data: { param: objectName },
            });
          },
        };
      },
    },
    "require-relative-import-js-extension": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Require relative import and export paths to include .js or other allowed extensions.",
        },
        schema: [],
        messages: {
          missingExtension:
            "Relative import paths must include an explicit extension like .js.",
        },
      },
      create(context) {
        const checkSource = (sourceNode) => {
          if (!sourceNode || sourceNode.type !== "Literal") return;
          const value = sourceNode.value;
          if (!isRelativeImportPath(value)) return;
          if (hasAllowedRelativeImportExtension(value)) return;
          context.report({ node: sourceNode, messageId: "missingExtension" });
        };

        return {
          ImportDeclaration(node) {
            checkSource(node.source);
          },
          ExportNamedDeclaration(node) {
            if (!node.source) return;
            checkSource(node.source);
          },
          ExportAllDeclaration(node) {
            if (!node.source) return;
            checkSource(node.source);
          },
        };
      },
    },
    "slash-options-required-first": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Require required SlashOption parameters to appear before optional parameters.",
        },
        schema: [],
        messages: {
          requiredAfterOptional:
            "Required slash options must be declared before optional options.",
        },
      },
      create(context) {
        return {
          MethodDefinition(node) {
            const params = node.value?.params;
            if (!params || !params.length) return;
            let seenOptional = false;

            for (const param of params) {
              const paramNode = param.type === "TSParameterProperty"
                ? param.parameter
                : param;
              const decorators = paramNode?.decorators ?? param.decorators ?? [];
              if (!decorators.length) continue;

              for (const decorator of decorators) {
                const decoratorExpression = decorator.expression;
                const decoratorName = getDecoratorIdentifierName(decoratorExpression);
                if (decoratorName !== SLASH_OPTION_DECORATOR) continue;

                const optionsNode = getDecoratorOptionsArg(decoratorExpression);
                const requiredValue = getObjectPropertyValue(optionsNode, "required");
                const isRequired = Boolean(
                  requiredValue &&
                  requiredValue.type === "Literal" &&
                  requiredValue.value === true,
                );
                if (!isRequired) {
                  seenOptional = true;
                } else if (seenOptional) {
                  context.report({ node: decorator, messageId: "requiredAfterOptional" });
                }
              }
            }
          },
        };
      },
    },
    "no-unused-imports-vars-local": {
      meta: {
        type: "problem",
        docs: {
          description: "Disallow unused imports and variables.",
        },
        schema: [],
        messages: {
          unusedVariable: "Unused variable '{{name}}'.",
        },
      },
      create(context) {
        return {
          "Program:exit"() {
            const unused = [];
            collectUnusedVariables(context.getScope(), unused);
            for (const variable of unused) {
              const identifier = variable.identifiers[0];
              if (!identifier) continue;
              context.report({
                node: identifier,
                messageId: "unusedVariable",
                data: { name: identifier.name },
              });
            }
          },
        };
      },
    },
    "no-build-folder-edits": {
      meta: {
        type: "problem",
        docs: {
          description: "Disallow linting files inside build folder.",
        },
        schema: [],
        messages: {
          buildFolder: "Do not edit files in the build folder.",
        },
      },
      create(context) {
        return {
          Program(node) {
            const filename = context.getFilename();
            if (!filename || filename === "<input>") return;
            if (filename.includes("/build/") || filename.includes("\\\\build\\\\")) {
              context.report({ node, messageId: "buildFolder" });
            }
          },
        };
      },
    },
    "attachment-builder-asset-path": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Require filesystem paths passed to AttachmentBuilder to resolve from src/assets and never build.",
        },
        schema: [],
        messages: {
          buildPath:
            "AttachmentBuilder file paths must not resolve from build/. Use resolveAssetPath(...) from src/assets.",
          invalidPath:
            "AttachmentBuilder file paths must resolve from src/assets. Use resolveAssetPath(...) helper.",
        },
      },
      create(context) {
        const urlPathMap = new Map();

        return {
          VariableDeclarator(node) {
            if (!node.id || node.id.type !== "Identifier") return;
            const resolved = resolveAttachmentPathExpression(node.init, urlPathMap);
            if (typeof resolved === "string") {
              urlPathMap.set(node.id.name, resolved);
            }
          },
          NewExpression(node) {
            if (node.callee.type !== "Identifier" || node.callee.name !== ATTACHMENT_BUILDER_NAME) {
              return;
            }

            const [firstArg] = node.arguments;
            if (!firstArg) return;

            if (isResolveAssetPathCall(firstArg)) return;

            const resolvedPath = resolveAttachmentPathExpression(firstArg, urlPathMap);
            if (typeof resolvedPath !== "string") return;

            const normalized = normalizePathText(resolvedPath);
            if (!normalized) return;

            if (normalized.includes("/build/") || normalized.startsWith("build/")) {
              context.report({ node: firstArg, messageId: "buildPath" });
              return;
            }

            if (!normalized.includes("src/assets/") && normalized !== "src/assets") {
              context.report({ node: firstArg, messageId: "invalidPath" });
            }
          },
        };
      },
    },
    "no-emdash": {
      meta: {
        type: "problem",
        docs: {
          description: "Disallow em dash characters.",
        },
        schema: [],
        messages: {
          emdash: "Do not use em dash characters.",
        },
      },
      create(context) {
        const sourceCode = context.getSourceCode();
        const reportIfEmdash = (node, text) => {
          if (typeof text !== "string") return;
          if (text.includes("—")) {
            context.report({ node, messageId: "emdash" });
          }
        };

        return {
          Program() {
            for (const comment of sourceCode.getAllComments()) {
              reportIfEmdash(comment, comment.value);
            }
          },
          Literal(node) {
            if (typeof node.value === "string") {
              reportIfEmdash(node, node.value);
            }
          },
          TemplateElement(node) {
            reportIfEmdash(node, node.value?.cooked ?? node.value?.raw);
          },
        };
      },
    },
    "channel-id-constants-in-channels-config": {
      meta: {
        type: "problem",
        docs: {
          description: "Require channel ID constants to be declared in channels config.",
        },
        schema: [],
        messages: {
          wrongFile: "Channel ID constants must be declared in src/config/channels.ts.",
        },
      },
      create(context) {
        const filename = context.getFilename().replace(/\\/g, "/");
        return {
          VariableDeclarator(node) {
            if (node.id.type !== "Identifier") return;
            const name = node.id.name;
            if (!name.endsWith(CHANNEL_ID_SUFFIX)) return;
            if (!isNumericIdString(node.init)) return;
            if (isAllowedIdConstantLocation(filename, CHANNEL_ID_SUFFIX)) return;
            context.report({ node: node.id, messageId: "wrongFile" });
          },
        };
      },
    },
    "user-id-constants-in-users-config": {
      meta: {
        type: "problem",
        docs: {
          description: "Require user ID constants to be declared in users config.",
        },
        schema: [],
        messages: {
          wrongFile: "User ID constants must be declared in src/config/users.ts.",
        },
      },
      create(context) {
        const filename = context.getFilename().replace(/\\/g, "/");
        return {
          VariableDeclarator(node) {
            if (node.id.type !== "Identifier") return;
            const name = node.id.name;
            if (!name.endsWith(USER_ID_SUFFIX)) return;
            if (!isNumericIdString(node.init)) return;
            if (isAllowedIdConstantLocation(filename, USER_ID_SUFFIX)) return;
            context.report({ node: node.id, messageId: "wrongFile" });
          },
        };
      },
    },
    "tag-id-constants-in-tags-config": {
      meta: {
        type: "problem",
        docs: {
          description: "Require tag ID constants to be declared in tags config.",
        },
        schema: [],
        messages: {
          wrongFile: "Tag ID constants must be declared in src/config/tags.ts.",
        },
      },
      create(context) {
        const filename = context.getFilename().replace(/\\/g, "/");
        return {
          VariableDeclarator(node) {
            if (node.id.type !== "Identifier") return;
            const name = node.id.name;
            if (!name.endsWith(TAG_ID_SUFFIX)) return;
            if (!isNumericIdString(node.init)) return;
            if (isAllowedIdConstantLocation(filename, TAG_ID_SUFFIX)) return;
            context.report({ node: node.id, messageId: "wrongFile" });
          },
        };
      },
    },
    "message-flag-id-constants-in-tags-config": {
      meta: {
        type: "problem",
        docs: {
          description: "Require message flag ID constants to be declared in tags config.",
        },
        schema: [],
        messages: {
          wrongFile:
            "Message flag ID constants must be declared in src/config/tags.ts.",
        },
      },
      create(context) {
        const filename = context.getFilename().replace(/\\/g, "/");
        return {
          VariableDeclarator(node) {
            if (node.id.type !== "Identifier") return;
            const name = node.id.name;
            if (!name.endsWith(MESSAGE_FLAG_ID_SUFFIX)) return;
            if (!isNumericIdString(node.init)) return;
            if (isAllowedIdConstantLocation(filename, MESSAGE_FLAG_ID_SUFFIX)) return;
            context.report({ node: node.id, messageId: "wrongFile" });
          },
        };
      },
    },
    "stable-custom-id": {
      meta: {
        type: "problem",
        docs: {
          description: "Disallow unstable values in interaction custom IDs.",
        },
        schema: [],
        messages: {
          unstableId: "Custom IDs must not use Date.now, Math.random, or randomUUID.",
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            const callee = node.callee;
            if (
              callee.type !== "MemberExpression" ||
              callee.property.type !== "Identifier" ||
              callee.property.name !== "setCustomId"
            ) {
              return;
            }
            const [arg] = node.arguments;
            if (!arg) return;
            if (containsUnstableExpression(arg)) {
              context.report({ node: arg, messageId: "unstableId" });
            }
          },
          Decorator(node) {
            const decoratorExpression = node.expression;
            const decoratorName = getDecoratorIdentifierName(decoratorExpression);
            if (!decoratorName || !INTERACTION_DECORATORS.has(decoratorName)) return;
            const idValueNode = getDecoratorIdValueArg(decoratorExpression);
            if (!idValueNode) return;
            if (containsUnstableExpression(idValueNode)) {
              context.report({ node: idValueNode, messageId: "unstableId" });
            }
          },
        };
      },
    },
    "no-duplicate-literal-custom-id-in-block": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow duplicate literal setCustomId values within the same block.",
        },
        schema: [],
        messages: {
          duplicateCustomId:
            "Duplicate literal custom id '{{customId}}' detected in this block.",
        },
      },
      create(context) {
        const seenByScope = new Map();

        return {
          CallExpression(node) {
            const callee = node.callee;
            if (
              callee.type !== "MemberExpression" ||
              callee.property.type !== "Identifier" ||
              callee.property.name !== "setCustomId"
            ) {
              return;
            }

            const rootBuilderName = getBuilderRootName(callee.object);
            if (!rootBuilderName || !CHECKED_SET_CUSTOM_ID_BUILDERS.has(rootBuilderName)) {
              return;
            }

            const [customIdArg] = node.arguments;
            const customId = getLiteralString(customIdArg);
            if (!customId) return;

            const scopeKey = getNearestBlockScopeKey(node);
            let seenInScope = seenByScope.get(scopeKey);
            if (!seenInScope) {
              seenInScope = new Map();
              seenByScope.set(scopeKey, seenInScope);
            }

            const firstSeenNode = seenInScope.get(customId);
            if (firstSeenNode) {
              context.report({
                node: customIdArg,
                messageId: "duplicateCustomId",
                data: { customId },
              });
              return;
            }

            seenInScope.set(customId, customIdArg);
          },
        };
      },
    },
    "components-v2-structure": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Enforce valid Components v2 container usage and ActionRow sizes.",
        },
        schema: [],
        messages: {
          tooManyComponents: "ActionRowBuilder supports 1 to 5 components.",
          invalidTopLevel:
            "Top-level components should be ContainerBuilder or ActionRowBuilder.",
        },
      },
      create(context) {
        const checkArrayElements = (elements) => {
          for (const element of elements) {
            if (!element) continue;
            if (element.type === "NewExpression") {
              if (
                element.callee.type === "Identifier" &&
                DISALLOWED_TOP_LEVEL_COMPONENT_BUILDERS.has(element.callee.name)
              ) {
                context.report({ node: element, messageId: "invalidTopLevel" });
              }
            }
            if (element.type === "ObjectExpression") {
              const typeValue = getObjectPropertyValue(element, "type");
              if (
                typeValue &&
                typeValue.type === "Literal" &&
                typeof typeValue.value === "number" &&
                typeValue.value !== 1
              ) {
                context.report({ node: element, messageId: "invalidTopLevel" });
              }
            }
          }
        };

        return {
          CallExpression(node) {
            const callee = node.callee;
            if (
              callee.type !== "MemberExpression" ||
              callee.property.type !== "Identifier" ||
              callee.property.name !== "addComponents"
            ) {
              return;
            }
            if (node.arguments.length > 5) {
              context.report({ node, messageId: "tooManyComponents" });
              return;
            }
            if (node.arguments.length === 1 && node.arguments[0].type === "ArrayExpression") {
              const arrayArg = node.arguments[0];
              if (arrayArg.elements.length > 5) {
                context.report({ node, messageId: "tooManyComponents" });
              }
            }
          },
          Property(node) {
            if (node.key.type !== "Identifier" && node.key.type !== "Literal") return;
            const keyName = getPropertyName(node.key);
            if (keyName !== "components") return;
            if (!node.value || node.value.type !== "ArrayExpression") return;
            checkArrayElements(node.value.elements);
          },
        };
      },
    },
    "no-components-v2-with-content": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Enforce Components v2 content rules for reply/edit/update payloads.",
        },
        schema: [],
        messages: {
          nonNullContent:
            "Do not include non-null content when using Components v2 flags.",
          requireNullContent:
            "When editing with Components v2 flags, include explicit content: null.",
        },
      },
      create(context) {
        const EDIT_METHODS = new Set(["editReply", "update", "safeUpdate"]);
        const CREATE_METHODS = new Set(["reply"]);

        const isComponentsV2Flag = (node) => {
          if (!node) return false;
          if (node.type === "Identifier" && node.name === "COMPONENTS_V2_FLAG") {
            return true;
          }
          if (
            node.type === "MemberExpression" &&
            node.property.type === "Identifier" &&
            node.property.name === "IS_COMPONENTS_V2"
          ) {
            return true;
          }
          return false;
        };

        const expressionIncludesComponentsV2 = (node) => {
          if (!node) return false;
          const nodes = [node];
          while (nodes.length) {
            const current = nodes.pop();
            if (!current) continue;
            if (isComponentsV2Flag(current)) return true;
            if (current.type === "CallExpression") {
              if (current.callee.type === "Identifier" &&
                current.callee.name === "buildComponentsV2Flags"
              ) {
                return true;
              }
            }
            for (const key of Object.keys(current)) {
              const value = current[key];
              if (!value) continue;
              if (Array.isArray(value)) {
                for (const item of value) {
                  if (item && typeof item.type === "string") nodes.push(item);
                }
              } else if (value && typeof value.type === "string") {
                nodes.push(value);
              }
            }
          }
          return false;
        };

        const isNullLiteral = (node) =>
          Boolean(node && node.type === "Literal" && node.value === null);

        const checkObject = (node, methodName) => {
          if (!node || node.type !== "ObjectExpression") return;
          const flagsProp = getObjectPropertyValue(node, "flags");
          if (!flagsProp) return;
          if (!expressionIncludesComponentsV2(flagsProp)) return;

          const contentProp = getObjectPropertyValue(node, "content");
          const isEditMethod = EDIT_METHODS.has(methodName);
          const isCreateMethod = CREATE_METHODS.has(methodName);
          if (!isEditMethod && !isCreateMethod) return;

          if (isEditMethod && !contentProp) {
            context.report({ node, messageId: "requireNullContent" });
            return;
          }

          if (contentProp && !isNullLiteral(contentProp)) {
            context.report({ node: contentProp, messageId: "nonNullContent" });
          }
        };

        return {
          CallExpression(node) {
            const callee = node.callee;
            if (callee.type === "Identifier") {
              if (!INTERACTION_RESPONSE_HELPERS.has(callee.name)) return;
              if (!EDIT_METHODS.has(callee.name) && !CREATE_METHODS.has(callee.name)) return;
              const arg = node.arguments[0];
              checkObject(arg, callee.name);
              return;
            }
            if (callee.type === "MemberExpression") {
              const methodName = getCalleePropertyName(callee);
              if (!methodName || !INTERACTION_RESPONSE_METHODS.has(methodName)) return;
              if (!EDIT_METHODS.has(methodName) && !CREATE_METHODS.has(methodName)) return;
              const arg = node.arguments[0];
              checkObject(arg, methodName);
            }
          },
        };
      },
    },
    "require-components-v2-flag-with-v2-components": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Require Components v2 flags when sending payloads containing Components v2 builders.",
        },
        schema: [],
        messages: {
          missingFlag:
            "Payloads with Components v2 builders must include Components v2 flags.",
        },
      },
      create(context) {
        const v2PayloadVariables = new Set();

        const isComponentsV2Flag = (node) => {
          if (!node) return false;
          if (node.type === "Identifier" && node.name === "COMPONENTS_V2_FLAG") {
            return true;
          }
          if (
            node.type === "MemberExpression" &&
            node.property.type === "Identifier" &&
            node.property.name === "IS_COMPONENTS_V2"
          ) {
            return true;
          }
          return false;
        };

        const expressionIncludesComponentsV2 = (node) => {
          if (!node) return false;
          const nodes = [node];
          while (nodes.length) {
            const current = nodes.pop();
            if (!current) continue;
            if (isComponentsV2Flag(current)) return true;
            if (
              current.type === "CallExpression" &&
              current.callee.type === "Identifier" &&
              current.callee.name === "buildComponentsV2Flags"
            ) {
              return true;
            }
            for (const key of Object.keys(current)) {
              const value = current[key];
              if (!value) continue;
              if (Array.isArray(value)) {
                for (const item of value) {
                  if (item && typeof item.type === "string") nodes.push(item);
                }
              } else if (value && typeof value.type === "string") {
                nodes.push(value);
              }
            }
          }
          return false;
        };

        const expressionContainsV2Builders = (node) => {
          if (!node) return false;
          const nodes = [node];
          while (nodes.length) {
            const current = nodes.pop();
            if (!current) continue;

            if (current.type === "NewExpression" && current.callee.type === "Identifier") {
              if (COMPONENTS_V2_ROOT_BUILDERS.has(current.callee.name)) {
                return true;
              }
            }

            if (current.type === "Identifier" && v2PayloadVariables.has(current.name)) {
              return true;
            }

            if (
              current.type === "MemberExpression" &&
              current.object.type === "Identifier" &&
              v2PayloadVariables.has(current.object.name)
            ) {
              return true;
            }

            for (const key of Object.keys(current)) {
              const value = current[key];
              if (!value) continue;
              if (Array.isArray(value)) {
                for (const item of value) {
                  if (item && typeof item.type === "string") nodes.push(item);
                }
              } else if (value && typeof value.type === "string") {
                nodes.push(value);
              }
            }
          }
          return false;
        };

        const markV2PayloadVariable = (node) => {
          if (!node || node.type !== "VariableDeclarator" || node.id.type !== "Identifier") {
            return;
          }

          const init = unwrapAwaitExpression(node.init);
          if (!init) return;

          if (init.type === "ObjectExpression") {
            const componentsValue = getObjectPropertyValue(init, "components");
            if (expressionContainsV2Builders(componentsValue)) {
              v2PayloadVariables.add(node.id.name);
            }
            return;
          }

          if (init.type !== "CallExpression") return;
          const calleeName = getCalledFunctionName(init.callee);
          if (!calleeName) return;
          if (COMPONENTS_V2_PAYLOAD_FACTORY_NAMES.has(calleeName)) {
            v2PayloadVariables.add(node.id.name);
          }
        };

        const checkSendPayload = (callNode, payloadNode) => {
          if (!payloadNode || payloadNode.type !== "ObjectExpression") return;
          const componentsValue = getObjectPropertyValue(payloadNode, "components");
          if (!componentsValue) return;
          if (!expressionContainsV2Builders(componentsValue)) return;
          const flagsValue = getObjectPropertyValue(payloadNode, "flags");
          if (flagsValue && expressionIncludesComponentsV2(flagsValue)) return;
          context.report({ node: callNode, messageId: "missingFlag" });
        };

        return {
          VariableDeclarator(node) {
            markV2PayloadVariable(node);
          },
          CallExpression(node) {
            const callee = node.callee;
            if (callee.type === "Identifier" && INTERACTION_RESPONSE_HELPERS.has(callee.name)) {
              checkSendPayload(node, node.arguments[0]);
              return;
            }
            if (callee.type !== "MemberExpression") return;
            const methodName = getCalleePropertyName(callee);
            if (!methodName) return;
            if (!INTERACTION_RESPONSE_METHODS.has(methodName) && !MESSAGE_SEND_METHODS.has(methodName)) {
              return;
            }
            checkSendPayload(node, node.arguments[0]);
          },
        };
      },
    },
    "dynamic-components-require-chunking": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Require explicit chunking helpers when message/payload builders assign dynamic components arrays.",
        },
        schema: [],
        messages: {
          requireChunking:
            "Dynamic components arrays in builder functions must use an explicit chunking helper.",
        },
      },
      create(context) {
        const CHUNKING_NAME_PATTERN = /(chunk|split|paginate|partition)/i;
        const BUILDER_NAME_PATTERN = /^build.*(Message|Messages|Payload|Response)/i;

        const isChunkingCall = (node) => {
          if (!node || node.type !== "CallExpression") return false;
          const calleeName = getCalledFunctionName(node.callee);
          if (!calleeName) return false;
          return CHUNKING_NAME_PATTERN.test(calleeName);
        };

        const isInsideForOfLoop = (node) => {
          let current = node?.parent ?? null;
          while (current) {
            if (current.type === "ForOfStatement" || current.type === "ForStatement") {
              return true;
            }
            current = current.parent ?? null;
          }
          return false;
        };

        return {
          Property(node) {
            const keyName = getPropertyName(node.key);
            if (keyName !== "components") return;
            if (node.value.type === "ArrayExpression") return;
            if (isChunkingCall(node.value)) return;

            const functionName = getEnclosingFunctionName(node);
            if (!functionName || !BUILDER_NAME_PATTERN.test(functionName)) return;

            // Allow looping over pre-chunked message objects: for (const message of messages) ...
            if (node.value.type === "MemberExpression" && isInsideForOfLoop(node)) {
              return;
            }

            context.report({ node: node.value, messageId: "requireChunking" });
          },
        };
      },
    },
    "custom-id-has-matching-handler": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Require interaction setCustomId prefixes to match an in-file component handler.",
        },
        schema: [],
        messages: {
          missingHandler:
            "No matching {{kind}} handler found for custom ID prefix '{{prefix}}'.",
        },
      },
      create(context) {
        let constantMap = new Map();
        const handlerPrefixesByKind = {
          button: new Set(),
          select: new Set(),
          modal: new Set(),
        };
        const pendingCalls = [];

        const addHandlerPrefix = (kind, prefix) => {
          if (!kind || !prefix) return;
          handlerPrefixesByKind[kind].add(prefix);
        };

        const hasMatchingPrefix = (kind, prefix) => {
          const handlers = handlerPrefixesByKind[kind];
          if (!handlers || !handlers.size) return false;
          for (const handlerPrefix of handlers) {
            if (prefix.startsWith(handlerPrefix) || handlerPrefix.startsWith(prefix)) {
              return true;
            }
          }
          return false;
        };

        return {
          Program(node) {
            constantMap = collectStaticStringConstants(node);
            handlerPrefixesByKind.button.clear();
            handlerPrefixesByKind.select.clear();
            handlerPrefixesByKind.modal.clear();
            pendingCalls.length = 0;
          },
          Decorator(node) {
            const decoratorExpression = node.expression;
            const decoratorName = getDecoratorIdentifierName(decoratorExpression);
            if (!decoratorName || !INTERACTION_DECORATORS.has(decoratorName)) return;
            const kind = getDecoratorKind(decoratorName);
            if (!kind) return;

            const idValueNode = getDecoratorIdValueArg(decoratorExpression);
            if (!idValueNode) return;

            const literalId = getLiteralString(idValueNode);
            if (literalId) {
              addHandlerPrefix(kind, literalId);
              return;
            }

            if (idValueNode.type === "Identifier") {
              const resolved = constantMap.get(idValueNode.name) ?? null;
              if (resolved) addHandlerPrefix(kind, resolved);
              return;
            }

            if (idValueNode.type === "TemplateLiteral") {
              const resolved = extractResolvablePrefix(idValueNode, constantMap);
              if (resolved) addHandlerPrefix(kind, resolved);
              return;
            }

            if (
              idValueNode.type === "Literal" &&
              idValueNode.regex &&
              typeof idValueNode.regex.pattern === "string"
            ) {
              const regexPrefix = extractRegexPrefix(idValueNode.regex.pattern);
              if (regexPrefix) addHandlerPrefix(kind, regexPrefix);
            }
          },
          CallExpression(node) {
            const callee = node.callee;
            if (
              callee.type !== "MemberExpression" ||
              callee.property.type !== "Identifier" ||
              callee.property.name !== "setCustomId"
            ) {
              return;
            }

            const rootBuilderName = getBuilderRootName(callee.object);
            const kind = getInteractionKindForBuilder(rootBuilderName);
            if (!kind) return;

            const [customIdArg] = node.arguments;
            const prefix = extractResolvablePrefix(customIdArg, constantMap);
            if (!prefix) return;

            pendingCalls.push({ node: customIdArg, kind, prefix });
          },
          "Program:exit"() {
            for (const call of pendingCalls) {
              if (hasMatchingPrefix(call.kind, call.prefix)) continue;
              context.report({
                node: call.node,
                messageId: "missingHandler",
                data: {
                  kind: call.kind,
                  prefix: call.prefix,
                },
              });
            }
          },
        };
      },
    },
  },
};
