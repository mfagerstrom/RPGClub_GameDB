export type TitleNormalizationStep = (value: string) => string;

export const IMPORT_TITLE_IGNORE_STEPS: TitleNormalizationStep[] = [
  (value) => value.replace(/\s*\((?:19|20)\d{2}(?:[/-]\d{1,2}){0,2}\)\s*/g, " "),
  (value) => value.replace(/[™®]/g, ""),
  (value) => value.replace(/[-\u2013\u2014]/g, " "),
  (value) => value.replace(/:/g, " "),
  (value) => value.replace(/^(the|a|an)\s+/i, ""),
  (value) => value.replace(/\s+(the|a|an)\s+/gi, " "),
  (value) => value.replace(/[^\p{L}\p{N}'-]+/gu, " "),
];

export function normalizeTitleWithSteps(
  rawTitle: string,
  steps: TitleNormalizationStep[] = IMPORT_TITLE_IGNORE_STEPS,
  stepCount: number = steps.length,
): string {
  let value = rawTitle.trim();
  const count = Math.min(Math.max(stepCount, 0), steps.length);
  for (let i = 0; i < count; i += 1) {
    value = steps[i](value);
  }
  return value.replace(/\s+/g, " ").trim();
}

export function buildProgressiveTitleVariants(
  rawTitle: string,
  steps: TitleNormalizationStep[] = IMPORT_TITLE_IGNORE_STEPS,
): string[] {
  const base = rawTitle.trim();
  const variants: string[] = [];

  const pushVariant = (value: string): void => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return;
    if (!variants.includes(normalized)) {
      variants.push(normalized);
    }
  };

  if (base) {
    pushVariant(base);
  }

  for (let i = 0; i < steps.length; i += 1) {
    const value = normalizeTitleWithSteps(base, steps, i + 1);
    pushVariant(value);
  }

  return variants;
}
