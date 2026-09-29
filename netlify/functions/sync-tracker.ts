import type { Config } from '@netlify/functions'
import { syncPending } from './_shared/google'
export default async function(){ await syncPending(20) }
export const config:Config={schedule:'*/5 * * * *'}
