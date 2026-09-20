// Locating a verified quote inside its passage (MAS-83).

// The quote is verbatim from the passage up to whitespace and quote style
// (that is how the API verified it), so match it the same loose way and
// wrap the span in <mark>. If it still cannot be found, show the passage
// unmarked rather than mark the wrong words.
export function markQuote(text: string, quote: string, withheld: number[][] = []) {
  const span = findQuote(text, quote)
  if (!span) return markSpans(text, withheld)
  const [start, end] = span
  return (
    <>
      {markSpans(text.slice(0, start), withheld, 0)}
      <mark data-testid="quote">{text.slice(start, end)}</mark>
      {markSpans(text.slice(end), withheld, end)}
    </>
  )
}

// Underline the sentences the guardrail withholds from the model (MAS-99), so
// the reader sees exactly what was hidden. `offset` is where `text` starts in
// the passage the spans refer to.
export function markSpans(text: string, withheld: number[][], offset = 0) {
  const spans = withheld
    .map(([a, b]) => [a - offset, b - offset] as const)
    .filter(([a, b]) => b > 0 && a < text.length)
    .map(([a, b]) => [Math.max(a, 0), Math.min(b, text.length)] as const)
    .sort((x, y) => x[0] - y[0])
  if (spans.length === 0) return text
  const parts: React.ReactNode[] = []
  let last = 0
  spans.forEach(([a, b], i) => {
    parts.push(text.slice(last, a))
    parts.push(
      <mark key={i} className="withheld" data-testid="withheld" title="Withheld from the model: instructions addressed to the AI">
        {text.slice(a, b)}
      </mark>,
    )
    last = b
  })
  parts.push(text.slice(last))
  return parts
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
