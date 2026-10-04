import 'dotenv/config'
import { readFile, readdir } from 'node:fs/promises'
import { Pool } from 'pg'
import { localEngine, localTestDatabase } from './database'

const folders = (await readdir(new URL('./migrations/', import.meta.url))).sort()
if (localTestDatabase()) {
  const db = await localEngine()
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  for (const name of folders) {
    const exists = await db.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])
    if (exists.rows.length) continue
    await db.exec(await readFile(new URL(`./migrations/${name}/migration.sql`, import.meta.url), 'utf8'))
    await db.query('INSERT INTO schema_migrations(name) VALUES($1)', [name])
    console.log('Applied', name)
  }
  await db.close()
} else {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required unless MIVELLE_TEST_MODE=true')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    for (const name of folders) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])
        if (!exists.rowCount) { await client.query(await readFile(new URL(`./migrations/${name}/migration.sql`, import.meta.url), 'utf8')); await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]); console.log('Applied', name) }
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    }
  } finally { await pool.end() }
}
