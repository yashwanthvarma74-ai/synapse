'use client'
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface TabDef {
  id: string
  label: string
  content: ReactNode
}

// WAI-ARIA tabs pattern: one tab is in the Tab order (roving tabindex), arrow keys
// move between tabs, Home and End jump to the ends, and each tab controls a panel.
export default function Tabs({ tabs, label }: { tabs: TabDef[]; label: string }) {
  const [active, setActive] = useState(tabs[0].id)
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
