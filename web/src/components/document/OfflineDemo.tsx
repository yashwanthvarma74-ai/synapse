'use client'
import { useState } from 'react'
import type { SynapseProvider } from '@/lib/collab/provider'
import { OfflineArt } from '../ui/Illustrations'

// A built-in way to see the main idea: switch the connection off, keep typing, switch it
// back on and watch everything merge. It only affects this browser window.
export default function OfflineDemo({ provider }: { provider: SynapseProvider }) {
  const [offline, setOffline] = useState(provider.isPartitioned())
  const [latency, setLatency] = useState(provider.getLatency())

  return (
    <details className="offline-demo">
      <summary>Try offline mode</summary>
      <div className="demo-body">
        <div>
          <p style={{ margin: '0 0 6px' }}>See what happens when the connection drops:</p>
          <ol>
            <li>Switch offline mode on. This window stops talking to the server.</li>
            <li>Keep typing. Open this page in a second window and type there too.</li>
            <li>Switch it off again. Both sets of changes merge, and nothing is lost.</li>
          </ol>
          <div className="offline-controls" role="group" aria-label="Offline mode demo">
            {/* A toggle: the name stays the same and aria-pressed carries the state.
                (Changing the label AND using aria-pressed reads as "Go online, pressed".) */}
            <button
              type="button"
              aria-pressed={offline}
              onClick={() => {
                provider.setPartitioned(!offline)
                setOffline(!offline)
              }}
            >
              Offline mode<span aria-hidden="true">{offline ? ' (on)' : ''}</span>
            </button>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              Slow the connection by
              <select
                style={{ flex: 'none' }}
                value={latency}
                onChange={(e) => {
                  const ms = Number(e.target.value)
                  provider.setLatency(ms)
                  setLatency(ms)
                }}
              >
                <option value={0}>nothing</option>
                <option value={200}>0.2 seconds</option>
                <option value={1000}>1 second</option>
                <option value={3000}>3 seconds</option>
              </select>
            </label>
          </div>
        </div>
        <OfflineArt small />
      </div>
    </details>
  )
}
