import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { db } from './server'
import { duplicatePhoto } from '../../shared/policy'

export async function inspectJpg(bytes: Buffer) {
  const meta = await sharp(bytes).metadata()
  if (meta.format !== 'jpeg' || !meta.width || !meta.height || bytes.length > 8_000_000) throw new Error('Upload a JPG under 8 MB')
  const ratio = meta.width/meta.height
  if (ratio < 0.8 || ratio > 1.91 || meta.width < 320) throw new Error('Image aspect ratio must be 4:5 to 1.91:1 and at least 320 px wide')
  const gray = await sharp(bytes).greyscale().resize(9,8,{fit:'fill'}).raw().toBuffer()
  let bits = 0n
  for (let y=0;y<8;y++) for (let x=0;x<8;x++) bits = (bits<<1n) | BigInt(gray[y*9+x] > gray[y*9+x+1] ? 1 : 0)
  return { sha256:createHash('sha256').update(bytes).digest('hex'), phash:bits.toString(16).padStart(16,'0'), width:meta.width, height:meta.height }
}
export async function assertUniquePhoto(sha256: string, phash: string) {
  const known = await db().sql`SELECT sha256,phash FROM photos`
  if (duplicatePhoto(sha256,phash,known as {sha256:string;phash:string|null}[])) throw new Error('This picture, or a renamed/reuploaded copy, is already in the library')
}
