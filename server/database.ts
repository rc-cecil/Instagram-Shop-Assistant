import { Pool } from 'pg'

let pool: Pool | undefined
function connection() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  return pool ||= new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })
}
export function db() {
  return { sql: async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '')
    return (await connection().query(query, values)).rows as any[]
  } }
}
export async function closeDatabase() { await pool?.end(); pool = undefined }
