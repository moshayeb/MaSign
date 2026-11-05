import { useCallback, useSyncExternalStore } from 'react'

// The reader's own ticks on the "Before you sign" checklist (MAS-218), one
// set per contract, kept in this browser only (never sent to the server).
// One shared store so the summary ring and the checklist always agree.

const memory = new Map<string, Set<string>>()
const listeners = new Set<() => void>()
const EMPTY: Set<string> = new Set()

function key(contractId: string) {
  return `masign:checked:${contractId}`
}

function read(contractId: string): Set<string> {
  const cached = memory.get(contractId)
  if (cached) return cached
  let ticks: Set<string> = EMPTY
  try {
    const raw = window.localStorage.getItem(key(contractId))
    if (raw) ticks = new Set(JSON.parse(raw) as string[])
  } catch {
    // storage blocked: the ticks still work for this visit
  }
  memory.set(contractId, ticks)
  return ticks
}

function write(contractId: string, ticks: Set<string>) {
  memory.set(contractId, ticks)
  try {
    window.localStorage.setItem(key(contractId), JSON.stringify([...ticks]))
  } catch {
    // storage blocked or full: kept in memory for this visit
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Only for tests: forget the in-memory copy so a cleared localStorage is re-read.
export function resetChecklistTicks() {
  memory.clear()
}

export function useChecklistTicks(contractId: string) {
  const ticked = useSyncExternalStore(subscribe, () => read(contractId), () => EMPTY)
  const toggle = useCallback(
    (id: string) => {
      const next = new Set(read(contractId))
      if (next.has(id)) next.delete(id)
      else next.add(id)
      write(contractId, next)
    },
    [contractId],
  )
  return { ticked, toggle }
}
