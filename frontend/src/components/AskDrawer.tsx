import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  onClose: () => void
  children: ReactNode
}

// MAS-194: extends MAS-177's SourcePanel pattern from Source to Ask MaSign,
// so asking a follow-up question does not lose whatever tab the reader was
// already on (App.tsx keeps the plain tab-switch for narrow screens, where
// this panel is never rendered at all). Not a modal: the underlying tab
// stays mounted, visible and scrollable the whole time, so there is no
// backdrop and no focus trap -- only Escape or the close button dismiss it,
// returning focus to whatever opened it.
export function AskDrawer({ onClose, children }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="ask-panel" role="complementary" aria-label="Ask MaSign">
      <div className="ask-panel-head">
        <span className="card-title">Ask MaSign</span>
        <button type="button" className="ask-panel-close" aria-label="Close Ask MaSign" ref={closeRef} onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div className="ask-panel-body">{children}</div>
    </aside>
  )
}
