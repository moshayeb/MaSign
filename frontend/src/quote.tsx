// Locating a verified quote inside its passage (MAS-83).

// The quote is verbatim from the passage up to whitespace and quote style
// (that is how the API verified it), so match it the same loose way and
// wrap the span in <mark>. If it still cannot be found, show the passage
// unmarked rather than mark the wrong words.
export function markQuote(text: string, quote: string) {
  const span = findQuote(text, quote)
  if (!span) return text
  const [start, end] = span
  return (
    <>
      {text.slice(0, start)}
      <mark data-testid="quote">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  )
}

export function findQuote(text: string, quote: string): [number, number] | null {
  const trimmed = quote.trim()
  if (!trimmed) return null
  const exact = text.indexOf(trimmed)
  if (exact >= 0) return [exact, exact + trimmed.length]
  const tokens = trimmed.split(/\s+/).map((token) =>
    token
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/["“”]/g, '["“”]')
      .replace(/['’]/g, "['’]"),
  )
  const match = new RegExp(tokens.join('\\s+'), 'i').exec(text)
  return match ? [match.index, match.index + match[0].length] : null
}
