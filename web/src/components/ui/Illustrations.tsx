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

// a mouse cursor with a name flag
const Cursor = ({ x, y, color, name }: { x: number; y: number; color: string; name: string }) => (
  <g transform={`translate(${x} ${y})`}>
    <path d="M0 0 L0 18 L5 13.5 L9 21 L12 19.5 L8 12.5 L15 12.5 Z" style={fill(color)} />
    <rect x="14" y="14" width={name.length * 7.2 + 14} height="20" rx="6" style={fill(color)} />
    <text x="21" y="28" fontSize="12" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">{name}</text>
  </g>
)

export function HeroArt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 520 420" {...svgProps}>
      <ellipse cx="260" cy="214" rx="250" ry="190" style={fill('var(--sticker-purple)')} />
      {/* the shared document */}
      <rect x="62" y="48" width="396" height="290" rx="18" style={fill('var(--surface)', { stroke: 'var(--line)', strokeWidth: 2 })} />
      <rect x="62" y="48" width="396" height="40" rx="18" style={fill('var(--panel)')} />
      <rect x="62" y="70" width="396" height="18" style={fill('var(--panel)')} />
      <circle cx="88" cy="68" r="5" style={fill('var(--line)')} /><circle cx="106" cy="68" r="5" style={fill('var(--line)')} /><circle cx="124" cy="68" r="5" style={fill('var(--line)')} />
      <Line x={92} y={112} w={170} color="var(--muted)" h={12} />
      {/* Yash's line, highlighted */}
      <rect x={90} y={140} width={252} height={14} rx={4} style={fill(A, { opacity: 0.18 })} />
      <Line x={92} y={143} w={248} /><Line x={92} y={170} w={300} /><Line x={92} y={197} w={210} />
      {/* Kalyan's line, highlighted */}
      <rect x={90} y={222} width={222} height={14} rx={4} style={fill(B, { opacity: 0.18 })} />
      <Line x={92} y={225} w={216} /><Line x={92} y={252} w={282} /><Line x={92} y={279} w={150} />
      <Cursor x={346} y={132} color={A} name="Yash" />
      <Cursor x={314} y={214} color={B} name="Kalyan" />
      {/* offline, still safe */}
      <g transform="translate(250 338)">
        <rect width="238" height="46" rx="23" style={fill('var(--surface)', { stroke: 'var(--line)', strokeWidth: 2 })} />
        <g transform="translate(16 12)" style={stroke('var(--warn)')} strokeWidth="2.4" strokeLinecap="round">
          <path d="M2 9 C 7 3, 17 3, 22 9" /><path d="M6 13.5 C 9.5 10, 14.5 10, 18 13.5" /><path d="M12 18 L12.2 18" /><path d="M1 1 L23 22" />
        </g>
        <text x="52" y="29" fontSize="14" fontWeight="700" fontFamily="system-ui, sans-serif" style={fill('var(--fg)')}>Offline? Still saved.</text>
      </g>
    </svg>
  )
}

export function WriteTogetherArt() {
  return (
    <svg viewBox="0 0 320 180" {...svgProps}>
      <rect x="40" y="16" width="240" height="148" rx="12" style={fill('var(--surface)', { stroke: 'var(--line)', strokeWidth: 2 })} />
      <Line x={62} y={40} w={110} color="var(--muted)" h={10} />
      <rect x={60} y={64} width={140} height={12} rx={4} style={fill(A, { opacity: 0.2 })} /><Line x={62} y={66} w={136} />
      <Line x={62} y={90} w={190} /><Line x={62} y={112} w={160} />
      <rect x={60} y={132} width={120} height={12} rx={4} style={fill(B, { opacity: 0.2 })} /><Line x={62} y={134} w={116} />
      <Cursor x={190} y={56} color={A} name="Yash" />
      <Cursor x={156} y={122} color={B} name="Kalyan" />
    </svg>
  )
}

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
          <g transform="translate(110 148)"><rect width="100" height="24" rx="12" style={fill('var(--sticker-purple)', { stroke: 'var(--line)' })} /><path d="M14 12 l4 4 l8 -9" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={stroke('var(--ok)')} /><text x="34" y="16" fontSize="11" fontWeight="700" fontFamily="system-ui, sans-serif" style={fill('var(--fg)')}>Saved here</text></g>
        </>
      )}
    </svg>
  )
}

export function MergeArt() {
  return (
    <svg viewBox="0 0 320 180" {...svgProps}>
      <rect x="14" y="20" width="96" height="70" rx="8" style={fill('var(--surface)', { stroke: 'var(--line)', strokeWidth: 2 })} />
      <rect x="26" y="34" width="60" height="9" rx="4.5" style={fill(A, { opacity: 0.9 })} /><Line x={26} y={52} w={70} /><Line x={26} y={68} w={44} />
      <rect x="14" y="100" width="96" height="70" rx="8" style={fill('var(--surface)', { stroke: 'var(--line)', strokeWidth: 2 })} />
      <rect x="26" y="114" width="60" height="9" rx="4.5" style={fill(B, { opacity: 0.9 })} /><Line x={26} y={132} w={70} /><Line x={26} y={148} w={44} />
      <path d="M118 55 C 150 55, 150 95, 182 95" strokeWidth="3" strokeLinecap="round" style={stroke(A)} /><path d="M118 135 C 150 135, 150 95, 182 95" strokeWidth="3" strokeLinecap="round" style={stroke(B)} />
      <path d="M176 88 l10 7 l-10 7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={stroke('var(--muted)')} />
      <rect x="196" y="40" width="112" height="100" rx="10" style={fill('var(--surface)', { stroke: 'var(--accent)', strokeWidth: 2.5 })} />
      <rect x="210" y="56" width="70" height="9" rx="4.5" style={fill(A, { opacity: 0.9 })} /><Line x={210} y={74} w={84} /><rect x="210" y="92" width="70" height="9" rx="4.5" style={fill(B, { opacity: 0.9 })} /><Line x={210} y={110} w={84} />
      <circle cx="296" cy="46" r="13" style={fill('var(--ok)')} /><path d="M290 46 l4 4 l8 -9" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" stroke="#0b1d12" />
    </svg>
  )
}

export function EmptyDocsArt() {
  return (
    <svg viewBox="0 0 200 140" {...svgProps}>
      <rect x="44" y="26" width="92" height="88" rx="10" transform="rotate(-8 90 70)" style={fill('var(--panel)', { stroke: 'var(--line)', strokeWidth: 2 })} />
      <rect x="62" y="20" width="96" height="94" rx="10" style={fill('var(--surface)', { stroke: 'var(--line)', strokeWidth: 2 })} />
      <Line x={76} y={40} w={46} color="var(--muted)" h={9} /><Line x={76} y={58} w={64} /><Line x={76} y={74} w={52} />
      <circle cx="150" cy="104" r="19" style={fill('var(--accent)')} /><path d="M150 95 v18 M141 104 h18" strokeWidth="3.4" strokeLinecap="round" style={stroke('var(--on-accent)')} />
    </svg>
  )
}

export function EmptyCommentsArt() {
  return (
    <svg viewBox="0 0 200 120" {...svgProps}>
      <path d="M36 22 h96 a12 12 0 0 1 12 12 v34 a12 12 0 0 1 -12 12 h-52 l-24 18 v-18 h-20 a12 12 0 0 1 -12 -12 v-34 a12 12 0 0 1 12 -12 z" style={fill('var(--surface)', { stroke: 'var(--line)', strokeWidth: 2 })} />
      <Line x={52} y={42} w={70} /><Line x={52} y={58} w={44} />
      <rect x="120" y="62" width="62" height="34" rx="9" style={fill(B, { opacity: 0.95 })} /><Line x={130} y={72} w={42} color="#ffffff" h={6} /><Line x={130} y={84} w={26} color="#ffffff" h={6} />
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
      <circle cx="132" cy="92" r="20" style={fill('var(--sticker-purple)', { stroke: 'var(--accent)', strokeWidth: 3 })} /><path d="M147 107 l16 16" strokeWidth="5" strokeLinecap="round" style={stroke('var(--accent)')} />
      <text x="132" y="99" textAnchor="middle" fontSize="20" fontWeight="800" fontFamily="system-ui, sans-serif" style={fill('var(--fg)')}>?</text>
    </svg>
  )
}
