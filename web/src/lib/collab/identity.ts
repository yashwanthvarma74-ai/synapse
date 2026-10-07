// Cursor identity: your account name plus a colour derived from it. Every colour has at least 4.5:1
// contrast with the white text on it (avatars, cursor labels); a test keeps new colours honest.
export const COLORS = ['#c2410c', '#1971c2', '#9c36b5', '#c2255c', '#0b7285', '#5f3dc4', '#087f5b', '#a16207']

export interface Identity {
  name: string
  color: string
}

export function getIdentity(name: string): Identity {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return { name, color: COLORS[hash % COLORS.length] }
}
