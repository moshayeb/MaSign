import { useEffect, useState } from 'react'

// Whether the viewport is at or above `breakpointPx` right now, kept in sync
// with resizes (MAS-177: the source side panel only opens on wide screens;
// narrower ones keep the older Sources-tab switch, App.tsx's `showSource`).
// The query is phrased as max-width so it matches the `(max-width: 960px)`
// breakpoint index.css already uses for the mobile drawer (MAS-126) exactly,
// and the stub tests already stand up for matchMedia checks for 'max-width'.
export function useIsWide(breakpointPx: number): boolean {
  const query = `(max-width: ${breakpointPx}px)`
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setNarrow(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return !narrow
}
