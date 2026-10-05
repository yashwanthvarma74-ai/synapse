import type { Role } from './api'

const RANK: Record<Role, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 }
// The server enforces roles; this only decides what the UI shows.
export const atLeast = (role: Role, min: Role) => RANK[role] >= RANK[min]
