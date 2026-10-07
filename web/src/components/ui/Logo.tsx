// The Synapse mark: two nodes joined by a curve (two copies of a document that always reconnect).
// Decorative; the word "Synapse" beside it is the accessible name.
export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="synapse-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#synapse-logo)" />
      <path d="M9 21 C 13 21, 13 11, 17 11 S 21 11, 23 11" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="9" cy="21" r="3.2" fill="#fff" />
      <circle cx="23" cy="11" r="3.2" fill="#fff" />
    </svg>
  )
}
