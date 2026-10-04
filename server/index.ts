import 'dotenv/config'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { db, closeDatabase } from './database'
import app from './handlers/api'
import media from './handlers/media'
import webhook from './handlers/meta-webhook'
import metaAuth from './handlers/meta-auth'
import { checkPassword, cookie, session, verifySession } from './auth'
import { postDue } from './services/posting'
import { POST_TIMES, postingSlot } from '../shared/policy'

const port = Number(process.env.PORT || 3000)
const base = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`
if (!process.env.DATABASE_URL && process.env.MIVELLE_TEST_MODE !== 'true') throw new Error('DATABASE_URL is required unless MIVELLE_TEST_MODE=true')
if (!process.env.OWNER_EMAIL || !process.env.OWNER_PASSWORD_HASH || !process.env.SESSION_SECRET) throw new Error('OWNER_EMAIL, OWNER_PASSWORD_HASH and SESSION_SECRET are required')
const allowPublish = process.env.ENABLE_META_PUBLISHING === 'true'
const allowDms = process.env.ENABLE_META_DM_SEND === 'true'
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', base)
    const headers = new Headers()
    for (const [key, value] of Object.entries(request.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value)
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : Readable.toWeb(request) as ReadableStream
    const req = new Request(url, { method: request.method, headers, body, duplex: 'half' } as RequestInit)
    let result: Response
    if (url.pathname === '/api/health') result = Response.json({ ok: true })
    else if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const input = await req.json() as { email?: string; password?: string }
      if (input.email !== process.env.OWNER_EMAIL || !checkPassword(input.password || '')) result = Response.json({ error: 'Invalid owner credentials' }, { status: 401 })
      else result = new Response(JSON.stringify({ email: input.email }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': `mivelle_session=${session(input.email!)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200` } })
    } else if (url.pathname === '/api/auth/me') result = Response.json(verifySession(cookie(req, 'mivelle_session')))
    else if (url.pathname === '/api/auth/logout') result = new Response('{}', { headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'mivelle_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' } })
    else if (url.pathname.startsWith('/api/app/')) result = await app(req)
    else if (url.pathname.startsWith('/api/media/')) result = await media(req, { params: { id: url.pathname.slice('/api/media/'.length) } })
    else if (url.pathname === '/api/meta/webhook') result = await webhook(req)
    else if (url.pathname.startsWith('/api/meta/auth/')) result = await metaAuth(req)
    else if (url.pathname === '/api/local/post' && req.method === 'POST') {
      if (!verifySession(cookie(req, 'mivelle_session'))) result = Response.json({ error: 'Owner sign-in required' }, { status: 401 })
      else if (!allowPublish) result = Response.json({ result: 'dry_run', slot: postingSlot(new Date()), times: POST_TIMES })
      else result = Response.json({ result: await postDue(new Date(), base, true) })
    } else result = Response.json({ error: 'Not found' }, { status: 404 })
    response.writeHead(result.status, Object.fromEntries(Array.from(result.headers, ([key, value]) => [key, value])))
    if (result.body) await Readable.fromWeb(result.body as any).pipe(response)
    else response.end()
  } catch (error) { console.error(error); response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'Internal server error' })) }
})
server.listen(port, () => console.log(`Mivelle backend listening on ${base}`))
let lastTick = ''
if (process.env.ENABLE_LOCAL_SCHEDULER === 'true') setInterval(async () => {
  const now = new Date(), slot = postingSlot(now)
  if (!slot || !allowPublish) return
  const tick = `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Accra', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)}:${slot}`
  if (tick === lastTick) return
  lastTick = tick
  try { console.log('Posting slot', tick, await postDue(now, base)) } catch (error) { console.error('Posting slot failed', error) }
}, 15000)
process.on('SIGINT', async () => { server.close(); await closeDatabase(); process.exit(0) })
