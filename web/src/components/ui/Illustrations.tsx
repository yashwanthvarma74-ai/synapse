// Inline SVG, so they add no image downloads and stay sharp at any size. They are decorative: each sits
// next to text that says the same thing, so screen readers skip them.
import type { CSSProperties } from 'react'

const A = '#c2255c' // two collaborator colours, both with 4.5:1 contrast against white text
const B = '#1971c2'

const fill = (v: string, extra: CSSProperties = {}): CSSProperties => ({ fill: v, ...extra })
const stroke = (v: string): CSSProperties => ({ fill: 'none', stroke: v })
const svgProps = { 'aria-hidden': true, focusable: false } as const

// a line of "text" in a document
const Line = ({ x, y, w, color = 'var(--line)', h = 8 }: { x: number; y: number; w: number; color?: string; h?: number }) => (
  <rect x={x} y={y} width={w} height={h} rx={h / 2} style={fill(color)} />
)

export function OfflineArt({ small = false }: { small?: boolean }) {
  return (
    <svg viewBox={small ? '0 0 150 110' : '0 0 320 180'} {...svgProps}>
      {small ? (
        <>
          <rect x="22" y="14" width="106" height="66" rx="8" style={fill('var(--surface)', { stroke: 'var(--line)', strokeWidth: 2 })} />
          <Line x={34} y={28} w={50} /><Line x={34} y={44} w={72} /><Line x={34} y={60} w={40} />
          <rect x="10" y="80" width="130" height="8" rx="4" style={fill('var(--line)')} />
          <g transform="translate(96 4)" style={stroke('var(--warn)')} strokeWidth="2.6" strokeLinecap="round"><path d="M2 9 C 7 3, 17 3, 22 9" /><path d="M6 13.5 C 9.5 10, 14.5 10, 18 13.5" /><path d="M1 1 L23 22" /></g>
          <text x="75" y="104" textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="system-ui, sans-serif" style={fill('var(--muted)')}>saved on this device</text>
        </>
      ) : (
        <>
          <rect x="70" y="20" width="180" height="108" rx="10" style={fill('var(--surface)', { stroke: 'var(--line)', strokeWidth: 2 })} />
          <Line x={92} y={42} w={90} /><Line x={92} y={64} w={130} /><Line x={92} y={86} w={80} />
          <rect x="48" y="128" width="224" height="12" rx="6" style={fill('var(--line)')} />
          <g transform="translate(246 0)" style={stroke('var(--warn)')} strokeWidth="3" strokeLinecap="round"><path d="M2 12 C 9 3, 23 3, 30 12" /><path d="M8 19 C 13 14, 19 14, 24 19" /><path d="M1 1 L31 30" /></g>
          <g transform="translate(110 148)"><rect width="100" height="24" rx="12" style={fill('var(--accent-soft)', { stroke: 'var(--line)' })} /><path d="M14 12 l4 4 l8 -9" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={stroke('var(--ok)')} /><text x="34" y="16" fontSize="11" fontWeight="700" fontFamily="system-ui, sans-serif" style={fill('var(--fg)')}>Saved here</text></g>
        </>
      )}
    </svg>
  )
}

export function JoinArt() {
  return (
    <svg viewBox="0 0 200 120" {...svgProps}>
      <circle cx="60" cy="52" r="26" style={fill(A)} /><circle cx="60" cy="44" r="9" style={fill('#fff')} /><path d="M42 68 a18 14 0 0 1 36 0" style={fill('#fff')} />
      <circle cx="140" cy="52" r="26" style={fill(B)} /><circle cx="140" cy="44" r="9" style={fill('#fff')} /><path d="M122 68 a18 14 0 0 1 36 0" style={fill('#fff')} />
      <path d="M92 52 C 98 38, 102 38, 108 52" strokeWidth="3.2" strokeLinecap="round" style={stroke('var(--accent)')} /><circle cx="100" cy="36" r="7" style={fill('var(--accent)')} />
      <Line x={52} y={96} w={96} color="var(--line)" h={8} />
    </svg>
  )
}

export function NotFoundArt() {
  return (
    <svg viewBox="0 0 200 140" {...svgProps}>
      <rect x="40" y="22" width="120" height="96" rx="12" style={fill('var(--surface)', { stroke: 'var(--line)', strokeWidth: 2 })} />
      <Line x={58} y={42} w={60} color="var(--muted)" h={9} /><Line x={58} y={60} w={84} /><Line x={58} y={76} w={50} />
      <circle cx="132" cy="92" r="20" style={fill('var(--accent-soft)', { stroke: 'var(--accent)', strokeWidth: 3 })} /><path d="M147 107 l16 16" strokeWidth="5" strokeLinecap="round" style={stroke('var(--accent)')} />
      <text x="132" y="99" textAnchor="middle" fontSize="20" fontWeight="800" fontFamily="system-ui, sans-serif" style={fill('var(--fg)')}>?</text>
    </svg>
  )
}
