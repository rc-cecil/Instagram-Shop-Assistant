import { storage } from '../storage'
import { db, fail } from '../services/server'
export default async function(_req: Request, context: {params:{id:string}}) {
  const rows = await db().sql`SELECT blob_key,status FROM photos WHERE id=${context.params.id}`
  if (!rows[0]?.blob_key || rows[0].status==='excluded') return fail('Image unavailable',404)
  const blob = await storage.get(rows[0].blob_key)
  if (!blob) return fail('Image unavailable',404)
  return new Response(blob,{headers:{'Content-Type':'image/jpeg','Cache-Control':'public,max-age=3600'}})
}
