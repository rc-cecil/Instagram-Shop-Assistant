import { POST_TIMES, ghanaDate, postingSlot } from '../../../shared/policy'
import { db, enqueueSync, graph, log } from './server'
import { inspectJpg } from './photos'
import { duplicatePhoto } from '../../../shared/policy'

export async function postDue(now = new Date(), origin: string, supervised = false) {
  const slot = supervised ? 'supervised' : postingSlot(now)
  if (!slot || (!supervised && !POST_TIMES.includes(slot as typeof POST_TIMES[number]))) return 'no_slot'
  const config = await db().sql`SELECT value FROM settings WHERE key='automation'`
  if (!supervised && !config[0]?.value?.posting) return 'paused'
  const date = ghanaDate(now)
  const already = await db().sql`SELECT id FROM posts WHERE slot_date=${date} AND slot_time=${slot} AND status IN ('publishing','published','uncertain')`
  if (already.length) return 'already_handled'
  const photos = await db().sql`SELECT ph.id,ph.approved_caption,p.name,p.source_url FROM photos ph JOIN products p ON p.id=ph.product_id WHERE ph.status='approved' AND p.approved=true AND p.excluded=false AND NOT EXISTS(SELECT 1 FROM posts po WHERE po.photo_id=ph.id AND po.status IN ('publishing','published','uncertain')) ORDER BY ph.created_at LIMIT 1`
  if (!photos.length) { await log('posting_empty',date,'No unused approved pictures remain'); return 'empty' }
  const photo = photos[0]
  // Meta is the source of truth if an earlier publish had an uncertain response.
  try {
    const current = await graph('{ig}/media?fields=id,media_url,permalink&limit=100')
    const target = await db().sql`SELECT sha256,phash FROM photos WHERE id=${photo.id}`
    for (const item of current.data || []) {
      if (!item.media_url) continue
      const response = await fetch(item.media_url)
      if (!response.ok) continue
      const { default: sharp } = await import('sharp')
      const jpg = await sharp(Buffer.from(await response.arrayBuffer())).jpeg().toBuffer()
      const fingerprint = await inspectJpg(jpg)
      if (duplicatePhoto(fingerprint.sha256,fingerprint.phash,target as {sha256:string;phash:string|null}[])) {
        await db().sql`UPDATE photos SET status='posted' WHERE id=${photo.id}`
        await log('duplicate_prevented',String(photo.id),'Image already appears on Instagram')
        return 'duplicate'
      }
    }
  } catch(error) { await log('posting_held',String(photo.id),`Instagram profile check failed: ${String(error)}`); return 'profile_check_failed' }
  const caption = photo.approved_caption || `${photo.name}. DM us with the size and colour you want, and we’ll confirm the details.`
  const postId = crypto.randomUUID()
  const claimed = await db().sql`INSERT INTO posts(id,photo_id,slot_date,slot_time,caption,status,attempted_at) VALUES (${postId},${photo.id},${date},${slot},${caption},'publishing',now()) ON CONFLICT(photo_id) DO NOTHING RETURNING id`
  if (!claimed.length) return 'claimed_elsewhere'
  try {
    const imageUrl = `${origin}/api/media/${photo.id}`
    const container = await graph('{ig}/media',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image_url:imageUrl,caption})})
    await db().sql`UPDATE posts SET media_container_id=${container.id} WHERE id=${postId}`
    const published = await graph('{ig}/media_publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({creation_id:container.id})})
    const media = await graph(`${published.id}?fields=id,permalink`)
    await db().sql`UPDATE posts SET media_id=${media.id},permalink=${media.permalink || null},status='published',published_at=now() WHERE id=${postId}`
    await db().sql`UPDATE photos SET status='posted' WHERE id=${photo.id}`
    await enqueueSync('post',postId)
    return 'published'
  } catch(error) {
    await db().sql`UPDATE posts SET status='uncertain',error=${String(error)} WHERE id=${postId}`
    await log('post_uncertain',postId,'Check the Instagram profile and media ID before retrying')
    return 'uncertain'
  }
}
