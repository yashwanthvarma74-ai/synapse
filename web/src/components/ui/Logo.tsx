// The Synapse mark: two nodes joined by a curve (two copies of a document that always reconnect).
// Decorative; the word "Synapse" beside it is the accessible name.
export default function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" style={{ fill: 'var(--accent)' }} />
      <path d="M9 21 C 13 21, 13 11, 17 11 S 21 11, 23 11" fill="none" strokeWidth="2.2" strokeLinecap="round" style={{ stroke: 'var(--on-accent)' }} />
      <circle cx="9" cy="21" r="3.2" style={{ fill: 'var(--on-accent)' }} />
      <circle cx="23" cy="11" r="3.2" style={{ fill: 'var(--on-accent)' }} />
    </svg>
  )
}
