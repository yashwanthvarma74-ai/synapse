'use client'
import { useState } from 'react'
import type { SynapseProvider } from '@/lib/provider'

// Demo tool: cut the connection or slow it down, to watch offline editing and
// the merge on reconnect. It only affects THIS browser window.
export default function NetworkSimulator({ provider }: { provider: SynapseProvider }) {
  const [offline, setOffline] = useState(provider.isPartitioned())
  const [latency, setLatency] = useState(provider.getLatency())

  return (
    <div className="sim" role="group" aria-label="Network simulator">
      <strong>Network simulator</strong>
      {/* A toggle: the label stays the same and aria-pressed carries the state.
          (Changing the label AND using aria-pressed reads as "Go online, pressed".) */}
      <button
        type="button"
        aria-pressed={offline}
        onClick={() => {
          provider.setPartitioned(!offline)
          setOffline(!offline)
        }}
      >
        Simulate offline<span aria-hidden="true">{offline ? ' (on)' : ''}</span>
      </button>
      <label>
        Delay{' '}
        <select
          value={latency}
          onChange={(e) => {
            const ms = Number(e.target.value)
            provider.setLatency(ms)
            setLatency(ms)
          }}
        >
          <option value={0}>none</option>
          <option value={200}>200 ms</option>
          <option value={1000}>1 s</option>
          <option value={3000}>3 s</option>
        </select>
      </label>
    </div>
  )
}
