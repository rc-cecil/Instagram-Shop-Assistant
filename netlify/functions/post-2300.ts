import type { Config } from '@netlify/functions'
import { postDue } from './_shared/posting'
export default async function(req:Request){ await postDue(new Date(),new URL(req.url).origin) }
export const config:Config={schedule:'0 23 * * *'}
