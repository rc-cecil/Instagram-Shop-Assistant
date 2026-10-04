import { db, env, eventId, fail, igCredentials, json, verifyMetaSignature } from '../services/server'
import { processPendingReplies } from '../services/replies'

type MetaEvent = { sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number; message?: { mid?: string; text?: string; attachments?: { payload?: { url?: string } }[]; is_echo?: boolean } }
export default async function(req: Request, context?: { waitUntil(promise: Promise<unknown>): void }) {
  if (req.method === 'GET') {
    const url = new URL(req.url)
    if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === env('META_VERIFY_TOKEN'))
      return new Response(url.searchParams.get('hub.challenge') || '', { status: 200 })
    return fail('Invalid verification token', 403)
  }
  if (req.method !== 'POST') return fail('Method not allowed', 405)
  const raw = await req.text()
  if (!verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), env('META_APP_SECRET'))) return fail('Invalid signature', 403)
  let payload: { object?: string; entry?: { messaging?: MetaEvent[] }[] }
  try { payload = JSON.parse(raw) } catch { return fail('Invalid JSON') }
  if (payload.object !== 'instagram' || !Array.isArray(payload.entry)) return fail('Unexpected webhook payload')
  const account = await igCredentials()
  if (!account) return fail('Approved Instagram account is not connected',503)
  for (const entry of payload.entry) for (const item of entry.messaging || []) {
    if (!item.sender?.id || !item.message?.mid || item.message.is_echo || item.recipient?.id !== account.id) continue
    const id = eventId(item.message, item.sender.id)
    // One SQL statement commits the event, message and job together. Retries fill
    // any missing record without creating a second send job.
    await db().sql`WITH event AS (
      INSERT INTO webhook_events(event_id,payload) VALUES (${id},${JSON.stringify(item)}::jsonb) ON CONFLICT DO NOTHING
    ), conversation AS (
      INSERT INTO conversations(id,last_message_at) VALUES (${item.sender.id},to_timestamp(${item.timestamp || Date.now()} / 1000.0))
      ON CONFLICT(id) DO UPDATE SET last_message_at=GREATEST(conversations.last_message_at,EXCLUDED.last_message_at),updated_at=now() RETURNING id
    ), message AS (
      INSERT INTO messages(id,meta_id,conversation_id,direction,body,attachment_url)
      SELECT ${crypto.randomUUID()}::uuid,${id},conversation.id,'inbound',${item.message.text || null},${item.message.attachments?.[0]?.payload?.url || null} FROM conversation
      ON CONFLICT(meta_id) DO NOTHING
    ) INSERT INTO reply_jobs(id,inbound_meta_id,conversation_id) VALUES (${crypto.randomUUID()},${id},${item.sender.id}) ON CONFLICT(inbound_meta_id) DO NOTHING`
    const evidence = item.message.attachments?.[0]?.payload?.url || (/\b(paid|sent payment|momo reference|transaction reference)\b/i.test(item.message.text || '') ? `Instagram message ${id}: ${item.message.text}` : null)
    if (evidence) {
      const pending = await db().sql`SELECT id FROM orders WHERE conversation_id=${item.sender.id} AND status IN ('agreed_waiting_payment','awaiting_payment_evidence') ORDER BY created_at DESC LIMIT 1`
      if (pending[0]) {
        await db().sql`UPDATE orders SET payment_evidence=${evidence},status='awaiting_owner_verification' WHERE id=${pending[0].id}`
        await db().sql`UPDATE conversations SET status='waiting_owner' WHERE id=${item.sender.id}`
      }
    }
  }
  const work = processPendingReplies(5).catch(error => console.error("Reply job failed", error))
  if (context) context.waitUntil(work)
  return json({ received: true })
}
