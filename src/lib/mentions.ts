/**
 * Mentions are written as `@Full Name` (the comment box inserts them from a member picker).
 * Names are matched case-insensitively against workspace members, longest name first, and must end at
 * a word boundary, so "@Ann" does not mention "Anna Lee" when only "Ann" is a member and vice versa.
 */
export function extractMentions(body: string, members: { userId: string; name: string }[]): string[] {
  const found = new Set<string>();
  const sorted = [...members].sort((a, b) => b.name.length - a.name.length);
  const lower = body.toLowerCase();
  for (let i = lower.indexOf("@"); i !== -1; i = lower.indexOf("@", i + 1)) {
    if (i > 0 && /[\p{L}\p{N}._%+-]/u.test(lower[i - 1])) continue; // part of an email address
    const rest = lower.slice(i + 1);
    const hit = sorted.find((m) => {
      const name = m.name.toLowerCase();
      return rest.startsWith(name) && !/[\p{L}\p{N}]/u.test(rest[name.length] ?? " ");
    });
    if (hit) found.add(hit.userId);
  }
  return [...found];
}
