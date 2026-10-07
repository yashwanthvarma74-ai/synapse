'use client'
import { useEffect, useRef, useState } from 'react'
import type { Collab } from '@/lib/collab/useCollab'

interface Peer {
  id: number
  name: string
  color: string
}

// The "who's here" bar: coloured initials for sighted users, a plain list of names for screen readers.
// Joins and leaves are announced politely and never move focus. People already here on arrival are not
// announced one by one.
export default function Presence({ collab }: { collab: Collab }) {
  const [peers, setPeers] = useState<Peer[]>([])
  const [announcement, setAnnouncement] = useState('')
  const known = useRef(new Map<number, string>())
  const settled = useRef(false)

  useEffect(() => {
    const { awareness } = collab
    // Ignore the burst of "joins" that arrives while we first connect
    const settle = setTimeout(() => (settled.current = true), 2000)
    const refresh = () => {
      const list: Peer[] = []
      awareness.getStates().forEach((state, id) => {
        const u = state.user as { name?: string; color?: string } | undefined
        if (u?.name) list.push({ id, name: u.name, color: u.color ?? '#555' })
      })
      setPeers(list)

      const now = new Map(list.map((p) => [p.id, p.name]))
      if (settled.current) {
        for (const [id, name] of now) {
          if (!known.current.has(id) && id !== awareness.clientID) setAnnouncement(`${name} joined`)
        }
        for (const [id, name] of known.current) {
          if (!now.has(id)) setAnnouncement(`${name} left`)
        }
      }
      known.current = now
    }
    awareness.on('change', refresh)
    refresh()
    return () => {
      clearTimeout(settle)
      awareness.off('change', refresh)
    }
  }, [collab])

  return (
    <div className="presence">
      <ul className="avatars" aria-label="People in this document">
        {peers.map((p) => (
          <li key={p.id}>
            <span className="avatar" style={{ background: p.color }} aria-hidden="true" title={p.name}>
              {p.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="sr-only">{p.name}</span>
          </li>
        ))}
      </ul>
      <span className="muted">{peers.length <= 1 ? "Just you here" : `${peers.length} people here`}</span>
      <span className="sr-only" role="status">{announcement}</span>
    </div>
  )
}
