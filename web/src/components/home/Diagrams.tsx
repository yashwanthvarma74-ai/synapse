// Small diagrams for the "What sets it apart" section. They are drawn in SVG with the design system's colours,
// so they stay sharp and follow the theme. Each one is decorative: the card around it states the same thing in
// words, so screen readers skip the picture.
import type { ReactNode } from 'react'

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg className="diagram" viewBox="0 0 320 140" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

type N = number | string
const Arrow = ({ x1, y1, x2, y2, dashed = false }: { x1: N; y1: N; x2: N; y2: N; dashed?: boolean }) => {
  const [ex, ey] = [Number(x2), Number(y2)]
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} className={dashed ? 'dg-line dg-dash' : 'dg-line'} />
      <path d={`M${ex - 5} ${ey - 3.5} L${ex} ${ey} L${ex - 5} ${ey + 3.5}`} className="dg-line" />
    </g>
  )
}

// A document drawn as a card with lines of text. `marks` colours some of the lines.
const Doc = ({ x, y, w = 56, h = 72, lines, accent = [] as number[] }: { x: number; y: number; w?: number; h?: number; lines: number[]; accent?: number[] }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx="6" className="dg-box" />
    {lines.map((len, i) => (
      <rect key={i} x={x + 8} y={y + 12 + i * 11} width={(w - 16) * len} height="5" rx="2.5" className={accent.includes(i) ? 'dg-fill-accent' : 'dg-fill'} />
    ))}
  </g>
)

// 1. The copy on your device is the working copy; the server is a relay.
export function LocalFirstDiagram() {
  return (
    <Frame>
      <rect x="16" y="20" width="176" height="100" rx="10" className="dg-box dg-box-accent" />
      <text x="28" y="38" className="dg-label dg-strong">Your device</text>
      <rect x="28" y="48" width="84" height="60" rx="6" className="dg-panel" />
      <rect x="36" y="58" width="60" height="5" rx="2.5" className="dg-fill" />
      <rect x="36" y="69" width="68" height="5" rx="2.5" className="dg-fill-accent" />
      <rect x="36" y="80" width="46" height="5" rx="2.5" className="dg-fill" />
      <text x="36" y="99" className="dg-small">working copy</text>
      <rect x="122" y="48" width="58" height="60" rx="6" className="dg-panel" />
      <text x="151" y="76" textAnchor="middle" className="dg-small">IndexedDB</text>
      <text x="151" y="88" textAnchor="middle" className="dg-small dg-faint">saved here</text>
      <Arrow x1="196" y1="70" x2="228" y2="70" dashed />
      <rect x="232" y="44" width="76" height="52" rx="8" className="dg-box dg-dashed-box" />
      <text x="270" y="66" textAnchor="middle" className="dg-label dg-strong">Server</text>
      <text x="270" y="80" textAnchor="middle" className="dg-small">relay + store</text>
    </Frame>
  )
}

// 2. Three replicas that were edited apart merge into one identical document.
export function ConvergeDiagram() {
  return (
    <Frame>
      <Doc x={10} y={24} lines={[0.9, 0.55, 0.8]} accent={[1]} />
      <Doc x={76} y={24} lines={[0.9, 0.8, 0.5]} accent={[2]} />
      <Doc x={142} y={24} lines={[0.9, 0.7, 0.65]} accent={[0, 1]} />
      {['A', 'B', 'C'].map((t, i) => (
        <text key={t} x={38 + i * 66} y="116" textAnchor="middle" className="dg-small">{t}</text>
      ))}
      <Arrow x1="206" y1="60" x2="234" y2="60" />
      <text x="220" y="52" textAnchor="middle" className="dg-small">merge</text>
      <Doc x={238} y={24} w={72} h={72} lines={[0.9, 0.8, 0.7]} accent={[1, 2]} />
      <circle cx="294" cy="40" r="9" className="dg-ok" />
      <path d="M289.5 40.5 L292.7 43.5 L298.5 36.8" className="dg-check" />
      <text x="274" y="116" textAnchor="middle" className="dg-small">identical</text>
    </Frame>
  )
}

// 3. Measured propagation time next to the 250 ms target, drawn to scale.
export function LatencyDiagram() {
  const W = 190 // pixels for the 250 ms target
  const bar = (ms: number) => Math.max(2, (ms / 250) * W)
  return (
    <Frame>
      <text x="14" y="38" className="dg-small">Target</text>
      <rect x="86" y="30" width={W} height="10" rx="3" className="dg-fill" />
      <text x={86 + W - 2} y="25" textAnchor="end" className="dg-small">250 ms</text>
      <text x="14" y="76" className="dg-small">One gateway</text>
      <rect x="86" y="68" width={bar(0.82)} height="10" rx="1" className="dg-fill-accent" />
      <text x={86 + bar(0.82) + 8} y="77" className="dg-label dg-strong">0.82 ms</text>
      <text x="14" y="108" className="dg-small">Via Redis</text>
      <rect x="86" y="100" width={bar(1.25)} height="10" rx="1" className="dg-fill-accent" />
      <text x={86 + bar(1.25) + 8} y="109" className="dg-label dg-strong">1.25 ms</text>
      <text x="306" y="132" textAnchor="end" className="dg-small dg-faint">p95, bars to scale</text>
    </Frame>
  )
}

// 4. Content merges; access is checked by the server on every write.
export function DomainsDiagram() {
  return (
    <Frame>
      <line x1="160" y1="14" x2="160" y2="126" className="dg-line dg-dash" />
      <text x="80" y="26" textAnchor="middle" className="dg-label dg-strong">Content</text>
      <path d="M26 52 C 56 52, 60 74, 90 74" className="dg-line dg-line-accent" />
      <path d="M26 96 C 56 96, 60 74, 90 74" className="dg-line dg-line-accent" />
      <circle cx="96" cy="74" r="6" className="dg-dot" />
      <text x="80" y="118" textAnchor="middle" className="dg-small">CRDT merge</text>
      <text x="240" y="26" textAnchor="middle" className="dg-label dg-strong">Access</text>
      <Arrow x1="182" y1="74" x2="222" y2="74" />
      <rect x="226" y="48" width="14" height="52" rx="3" className="dg-gate" />
      <rect x="250" y="64" width="22" height="20" rx="4" className="dg-box dg-box-accent" />
      <path d="M255 64 v-5 a6 6 0 0 1 12 0 v5" className="dg-line dg-line-accent" />
      <text x="240" y="118" textAnchor="middle" className="dg-small">checked every write</text>
    </Frame>
  )
}

// 5. Clients talk to stateless gateways, which share state through Redis and MongoDB.
export function GatewaysDiagram() {
  return (
    <Frame>
      {[34, 70, 106].map((y) => (
        <circle key={y} cx="20" cy={y} r="7" className="dg-box dg-box-accent" />
      ))}
      <Arrow x1="29" y1="38" x2="82" y2="46" />
      <Arrow x1="29" y1="70" x2="82" y2="52" />
      <Arrow x1="29" y1="70" x2="82" y2="90" />
      <Arrow x1="29" y1="104" x2="82" y2="96" />
      <rect x="86" y="30" width="64" height="34" rx="6" className="dg-box" />
      <text x="118" y="51" textAnchor="middle" className="dg-small dg-strong">Gateway</text>
      <rect x="86" y="76" width="64" height="34" rx="6" className="dg-box" />
      <text x="118" y="97" textAnchor="middle" className="dg-small dg-strong">Gateway</text>
      <line x1="150" y1="47" x2="184" y2="62" className="dg-line" />
      <line x1="150" y1="93" x2="184" y2="78" className="dg-line" />
      <rect x="184" y="50" width="56" height="40" rx="6" className="dg-box dg-box-accent" />
      <text x="212" y="67" textAnchor="middle" className="dg-small dg-strong">Redis</text>
      <text x="212" y="79" textAnchor="middle" className="dg-small dg-faint">pub/sub</text>
      <line x1="150" y1="104" x2="262" y2="104" className="dg-line dg-dash" />
      <ellipse cx="288" cy="94" rx="22" ry="7" className="dg-box" />
      <path d="M266 94 v18 a22 7 0 0 0 44 0 v-18" className="dg-box" />
      <text x="288" y="130" textAnchor="middle" className="dg-small">MongoDB</text>
    </Frame>
  )
}

// 6. Metrics, a dashboard and alerts, and load tests.
export function ObservabilityDiagram() {
  const bars = [30, 44, 36, 58, 48, 64, 52]
  return (
    <Frame>
      <rect x="14" y="20" width="128" height="94" rx="8" className="dg-box" />
      <text x="24" y="37" className="dg-small dg-strong">Dashboard</text>
      {bars.map((h, i) => (
        <rect key={i} x={26 + i * 16} y={104 - h} width="10" height={h} rx="2" className={i === 5 ? 'dg-fill-accent' : 'dg-fill'} />
      ))}
      <rect x="158" y="20" width="148" height="40" rx="8" className="dg-box" />
      <text x="168" y="37" className="dg-small dg-strong">SLO alert</text>
      <path d="M168 49 L196 49 L206 43 L216 53 L226 46 L296 46" className="dg-line dg-line-accent" />
      <rect x="158" y="74" width="148" height="40" rx="8" className="dg-box" />
      <text x="168" y="91" className="dg-small dg-strong">Load test</text>
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
        <circle key={i} cx={170 + i * 11.5} cy={103} r="2.6" className="dg-dot-ok" />
      ))}
    </Frame>
  )
}
