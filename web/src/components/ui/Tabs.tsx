'use client'
import type { ReactNode } from 'react'
import { Tabs as MeridianTabs, TabsList, TabsPanel, TabsTab } from '@yashwanthvarma74/react'

export interface TabDef {
  id: string
  label: string
  content: ReactNode
  badge?: number // unread items: shown as a small count, and spoken as "(3 new)"
}

// The design system's tabs do the keyboard work (roving focus, arrows, Home and End) and the ARIA wiring.
// This wrapper only maps Synapse's tab list onto them and adds the unread count.
export default function Tabs({ tabs, label, onChange }: { tabs: TabDef[]; label: string; onChange?: (id: string) => void }) {
  return (
    <MeridianTabs defaultValue={tabs[0].id} onValueChange={onChange}>
      <TabsList aria-label={label}>
        {tabs.map((t) => (
          <TabsTab key={t.id} value={t.id}>
            {t.label}
            {t.badge ? (
              <>
                <span className="tab-badge" aria-hidden="true">{t.badge > 99 ? '99+' : t.badge}</span>
                <span className="sr-only"> ({t.badge} new)</span>
              </>
            ) : null}
          </TabsTab>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsPanel key={t.id} value={t.id}>{t.content}</TabsPanel>
      ))}
    </MeridianTabs>
  )
}
