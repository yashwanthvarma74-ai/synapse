'use client'
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface TabDef {
  id: string
  label: string
  content: ReactNode
  badge?: number // unread items: shown as a small count, and spoken as "(3 new)"
}

// WAI-ARIA tabs pattern: one tab is in the Tab order (roving tabindex), arrows move between tabs, Home
// and End jump to the ends, and each tab controls a panel.
export default function Tabs({ tabs, label, onChange }: { tabs: TabDef[]; label: string; onChange?: (id: string) => void }) {
  const [active, setActiveState] = useState(tabs[0].id)
  const setActive = (id: string) => {
    setActiveState(id)
    onChange?.(id)
  }
  const base = useId()
  const refs = useRef(new Map<string, HTMLButtonElement>())

  function onKeyDown(e: KeyboardEvent, index: number) {
    const last = tabs.length - 1
    const next = e.key === 'ArrowRight' ? (index + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : -1
    if (next < 0) return
    e.preventDefault()
    setActive(tabs[next].id)
    refs.current.get(tabs[next].id)?.focus()
  }

  return (
    <div>
      <div className="tabs" role="tablist" aria-label={label}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { if (el) refs.current.set(t.id, el) }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.label}
            {t.badge ? (
              <>
                <span className="tab-badge" aria-hidden="true">{t.badge > 99 ? '99+' : t.badge}</span>
                <span className="sr-only"> ({t.badge} new)</span>
              </>
            ) : null}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`${base}-panel-${t.id}`} aria-labelledby={`${base}-tab-${t.id}`} hidden={active !== t.id}>
          {active === t.id ? t.content : null}
        </div>
      ))}
    </div>
  )
}
