import { getDatabase } from '@netlify/database'
import { getUser } from '@netlify/identity'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const db = () => getDatabase()
export const env = (key: string) => Netlify.env.get(key) || ''
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
export const fail = (message: string, status = 400) => json({ error: message }, status)

function cookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') || ''
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return null
}

export async function owner(req?: Request): Promise<{ id: string; email: string } | null> {
  let user = await getUser()
  // Netlify's request context can occasionally omit Identity even though the
  // signed-in browser sent its nf_jwt cookie. Validate that token against this
  // site's Identity endpoint before treating the request as authenticated.
  if (!user && req) {
    const authorization = req.headers.get('authorization') || ''
    const jwt = authorization.startsWith('Bearer ') ? authorization.slice(7) : cookie(req, 'nf_jwt')
    if (jwt) {
      const identityUrl = new URL('/.netlify/identity/user', req.url)
      const response = await fetch(identityUrl, { headers: { Authorization: `Bearer ${jwt}` } })
      if (response.ok) user = await response.json()
    }
  }
  const email = env('OWNER_EMAIL')
  return user?.email && email && user.email.toLowerCase() === email.toLowerCase() ? { id: user.id, email: user.email } : null
}
export async function log(kind: string, entityId: string, detail: string) {
  await db().sql`INSERT INTO activity(id,kind,entity_id,detail) VALUES (${crypto.randomUUID()},${kind},${entityId},${detail})`
}
export async function recordUpdate(kind: string, entityId: string) {
  await log(`${kind}_updated`, entityId, `${kind} record updated in the system`)
}
export function verifyMetaSignature(raw: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', secret).update(raw).digest('hex')
  const received = signature.slice(7)
  return received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected))
}
export function eventId(message: { mid?: string; id?: string; timestamp?: number }, sender: string): string {
  return message.mid || message.id || createHash('sha256').update(JSON.stringify(message) + sender).digest('hex')
}
function key(): Buffer {
  const raw = env('TOKEN_ENCRYPTION_KEY')
  if (!/^[0-9a-f]{64}$/i.test(raw)) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 random bytes as hex')
  return Buffer.from(raw, 'hex')
}
export function encrypt(secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map(v => v.toString('base64url')).join('.')
}
export function decrypt(value: string): string {
  const [iv, tag, body] = value.split('.').map(v => Buffer.from(v, 'base64url'))
  const cipher = createDecipheriv('aes-256-gcm', key(), iv)
  cipher.setAuthTag(tag)
  return Buffer.concat([cipher.update(body), cipher.final()]).toString('utf8')
}
export async function igCredentials(): Promise<{ id: string; token: string } | null> {
  const rows = await db().sql`SELECT value FROM settings WHERE key='instagram_connection'`
  if (rows[0]?.value?.id && rows[0]?.value?.token) return { id: rows[0].value.id, token: decrypt(rows[0].value.token) }
  const id = env('META_IG_ACCOUNT_ID'), token = env('META_IG_ACCESS_TOKEN')
  return id && token ? { id, token } : null
}
export async function graph(path: string, init: RequestInit = {}) {
  const creds = await igCredentials()
  if (!creds) throw new Error('Instagram connection is missing')
  const response = await fetch(`https://graph.instagram.com/v24.0/${path.replace('{ig}', creds.id)}`, {
    ...init, headers: { Authorization: `Bearer ${creds.token}`, ...(init.headers || {}) }
  })
  const data = await response.json()
  if (!response.ok || data.error) throw new Error(`Meta API ${response.status}: ${data.error?.message || 'request failed'}`)
  return data
}
