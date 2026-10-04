import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto'
const env = (key: string) => process.env[key] || ''

const ttl = 12 * 60 * 60 * 1000
const signature = (payload: string) => createHmac('sha256', env('SESSION_SECRET')).update(payload).digest('base64url')
export function session(email: string) { const payload = Buffer.from(JSON.stringify({ email, expires: Date.now() + ttl })).toString('base64url'); return `${payload}.${signature(payload)}` }
export function verifySession(token: string | undefined) {
  if (!token || !env('SESSION_SECRET')) return null
  const [payload, mac] = token.split('.')
  if (!payload || !mac) return null
  const expected = signature(payload)
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString()); return data.expires > Date.now() && data.email === env('OWNER_EMAIL') ? { id: data.email, email: data.email } : null } catch { return null }
}
export function checkPassword(password: string) {
  const hash = env('OWNER_PASSWORD_HASH')
  const [salt, expected] = hash.split(':')
  if (!salt || !expected || !/^[a-f0-9]{64}$/i.test(expected)) return false
  const actual = scryptSync(password, salt, 32)
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'))
}
export function cookie(req: Request, name: string) { return req.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1) }
