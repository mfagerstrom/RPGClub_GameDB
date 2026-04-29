import GameSearchSynonym from "../classes/GameSearchSynonym.js";

export function parseSynonymQuickAddTerms(
  baseTerm: string,
  requiredSynonym: string,
  additionalSynonyms: string | undefined,
): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  const addTerm = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const norm = GameSearchSynonym.normalizeTerm(trimmed);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    terms.push(trimmed);
  };

  addTerm(baseTerm);
  addTerm(requiredSynonym);

  if (additionalSynonyms) {
    const chunks = additionalSynonyms
      .split(/[\n,;|]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    for (const chunk of chunks) {
      addTerm(chunk);
    }
  }

  return terms;
}
