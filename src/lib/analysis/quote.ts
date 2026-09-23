// Accept whitespace differences only, then retain the literal source substring.
export function sourceQuote(text: string, quote: string): string | undefined {
  const trimmed = quote.trim();
  if (!trimmed) return undefined;
  if (text.includes(trimmed)) return trimmed;
  const pattern = trimmed.split(/\s+/u).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return text.match(new RegExp(pattern, "u"))?.[0];
}
