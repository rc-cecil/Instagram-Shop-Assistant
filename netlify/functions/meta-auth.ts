import type { Config } from '@netlify/functions'
import { db, encrypt, env, fail, json, owner } from './_shared/server'

export default async function(req: Request) {
  const user = await owner()
  if (!user) return fail('Owner sign-in required', 401)
  const url = new URL(req.url)
  const base = `${url.protocol}//${url.host}`
  const redirect = `${base}/api/meta/auth/callback`
  if (url.pathname.endsWith('/start')) {
    if (!env('META_APP_ID') || !env('META_APP_SECRET')) return fail('Meta app ID and secret are not configured')
    const state = crypto.randomUUID()
    await db().sql`INSERT INTO settings(key,value) VALUES ('oauth_state',${JSON.stringify({state,created:Date.now()})}::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`
    const auth = new URL('https://www.instagram.com/oauth/authorize')
    auth.searchParams.set('client_id', env('META_APP_ID'))
    auth.searchParams.set('redirect_uri', redirect)
    auth.searchParams.set('response_type', 'code')
    auth.searchParams.set('scope', 'instagram_business_basic,instagram_business_manage_messages,instagram_business_content_publish')
    auth.searchParams.set('state', state)
    return Response.redirect(auth, 302)
  }
  if (!url.pathname.endsWith('/callback')) return fail('Not found', 404)
  const state = await db().sql`SELECT value FROM settings WHERE key='oauth_state'`
  if (!state[0] || state[0].value.state !== url.searchParams.get('state') || Date.now() - state[0].value.created > 600000) return fail('OAuth state expired or invalid', 403)
  const code = url.searchParams.get('code')
  if (!code) return fail('Instagram did not return an authorization code')
  const form = new URLSearchParams({ client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET'), grant_type:'authorization_code', redirect_uri:redirect, code })
  const tokenResponse = await fetch('https://api.instagram.com/oauth/access_token', { method:'POST', body:form })
  const short = await tokenResponse.json()
  if (!tokenResponse.ok || !short.access_token) return fail('Instagram token exchange failed', 502)
  const longUrl = new URL('https://graph.instagram.com/access_token')
  longUrl.searchParams.set('grant_type','ig_exchange_token')
  longUrl.searchParams.set('client_secret',env('META_APP_SECRET'))
  longUrl.searchParams.set('access_token',short.access_token)
  const longResponse = await fetch(longUrl)
  const long = await longResponse.json()
  if (!longResponse.ok || !long.access_token) return fail('Long-lived Instagram token exchange failed', 502)
  const profileResponse = await fetch('https://graph.instagram.com/v24.0/me?fields=id,username', { headers:{ Authorization:`Bearer ${long.access_token}` } })
  const profile = await profileResponse.json()
  if (!profileResponse.ok || profile.username !== '_testing.account1') return fail('Connected account is not the approved test account', 403)
  await db().sql`INSERT INTO settings(key,value) VALUES ('instagram_connection',${JSON.stringify({id:profile.id,username:profile.username,token:encrypt(long.access_token),expiresAt:Date.now()+(long.expires_in || 5184000)*1000})}::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`
  await db().sql`DELETE FROM settings WHERE key='oauth_state'`
  return Response.redirect(`${base}/?connected=instagram`,302)
}
export const config: Config = { path: ['/api/meta/auth/start','/api/meta/auth/callback'] }
