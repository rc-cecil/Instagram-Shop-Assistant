import { Pool } from 'pg'
import type { PGlite } from '@electric-sql/pglite'

let pool: Pool | undefined
let local: Promise<PGlite> | undefined
export const localTestDatabase = () => !process.env.DATABASE_URL && process.env.MIVELLE_TEST_MODE === 'true'
export async function localEngine() {
  if (!localTestDatabase()) throw new Error('Local test database is disabled')
  return local ||= (async () => { const { PGlite } = await import('@electric-sql/pglite'); return new PGlite(process.env.MIVELLE_TEST_DB_DIR || 'data/pglite') })()
}
function connection() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required unless MIVELLE_TEST_MODE=true')
  return pool ||= new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })
}
export function db() {
  return { sql: async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '')
    if (localTestDatabase()) return (await (await localEngine()).query(query, values as any[])).rows as any[]
    return (await connection().query(query, values)).rows as any[]
  } }
}
export async function closeDatabase() { await pool?.end(); pool = undefined; if (local) await (await local).close(); local = undefined }
