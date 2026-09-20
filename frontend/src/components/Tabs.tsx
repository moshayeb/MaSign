import type { KeyboardEvent } from 'react'

export interface TabSpec<T extends string> {
  id: T
  label: string
  // A short count or state shown after the label (e.g. "· High").
  hint?: string
}

interface Props<T extends string> {
  tabs: TabSpec<T>[]
  active: T
  onChange: (id: T) => void
  label: string
}

// A WAI-ARIA tab list (MAS-95): arrow keys, Home and End move between tabs,
// the active tab is the only one in the tab order.
export function Tabs<T extends string>({ tabs, active, onChange, label }: Props<T>) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((t) => t.id === active)
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    onChange(tabs[next].id)
    document.getElementById(`tab-${tabs[next].id}`)?.focus()
  }

  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            className={selected ? 'tab active' : 'tab'}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {tab.hint && <span className="tab-hint">{tab.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel<T extends string>({ id, active, children }: { id: T; active: T; children: React.ReactNode }) {
  // Inactive panels stay mounted but hidden, so an answer, a draft or the
  // reader's position survives a tab switch.
  return (
    <div id={`panel-${id}`} role="tabpanel" aria-labelledby={`tab-${id}`} hidden={id !== active} className="tabpanel">
      {children}
    </div>
  )
}
