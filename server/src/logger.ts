// One structured JSON logger for the whole server (Pino). LOG_LEVEL=debug for more detail.
// Never log tokens, passwords or full connection strings.
import { pino } from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: ['req.headers.authorization', 'password', 'token'],
})
