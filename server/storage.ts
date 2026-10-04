import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname, relative, sep } from 'node:path'

const root = resolve(process.env.MEDIA_DIRECTORY || 'data/products')
function target(key: string) {
  const path = resolve(root, key)
  if (relative(root, path).startsWith('..') || !path.startsWith(root + sep)) throw new Error('Invalid media key')
  return path
}
export const storage = {
  async put(key: string, bytes: Uint8Array) { const path = target(key); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes) },
  async get(key: string) { try { return await readFile(target(key)) } catch (error: any) { if (error.code === 'ENOENT') return null; throw error } }
}
