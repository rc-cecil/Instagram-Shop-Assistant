import type { Config } from '@netlify/functions'
import { processPendingReplies } from './_shared/replies'
import { db } from './_shared/server'
export default async function() {
  // A terminated worker may have sent a request. Hold its records for review.
  await db().sql`UPDATE reply_jobs SET status='uncertain',error='Worker stopped before outcome was recorded; inspect Instagram',updated_at=now() WHERE status IN ('processing','sending') AND updated_at<now()-interval '5 minutes'`
  await processPendingReplies(5)
}
export const config: Config = { schedule: '* * * * *' }
