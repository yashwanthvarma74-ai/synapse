// Passwords: scrypt (built into Node, memory-hard). Sessions: signed JWTs (HS256).
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { SignJWT, jwtVerify } from 'jose'

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string) {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64)
  return expected.length === actual.length && timingSafeEqual(expected, actual) // constant time
}

export async function signToken(userId: string, secret: string, ttl = '12h') {
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setExpirationTime(ttl)
    .sign(new TextEncoder().encode(secret))
}

// Returns the user id, or null for a missing / forged / expired token
export async function verifyToken(token: string | null | undefined, secret: string): Promise<string | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] })
    return payload.sub ?? null
  } catch {
    return null
  }
}
