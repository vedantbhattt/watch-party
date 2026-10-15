/** Small, dependency-free fuzzy matching for the local movie catalogue. */
export function normalizeSearchText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

/** True when each query token matches a catalogue token, allowing a small typo. */
export function fuzzyMatches(query: string, ...fields: string[]): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const tokens = normalizeSearchText(fields.join(" ")).split(/\s+/).filter(Boolean);
  return queryTokens.every((queryToken) => tokens.some((token) => {
    if (token.includes(queryToken) || queryToken.includes(token)) return true;
    if (queryToken.length < 4 || token.length < 4) return false;
    const allowedDistance = queryToken.length >= 8 ? 2 : 1;
    return editDistance(queryToken, token) <= allowedDistance;
  }));
}
