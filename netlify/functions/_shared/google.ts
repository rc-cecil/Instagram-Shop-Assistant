import { createSign } from 'node:crypto'
import { db, env } from './server'

const folderId = '1egAhH0ODEbFm8fKyxpMe1aPEklf2cWhG'
const sheetId = '1Cjp7kBqiDRF77eFO5KzD_XXPH513keAIAtvqbAFp5HQ'
function credentials() {
  const raw = env('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!raw) throw new Error('Google Drive service account is not connected')
  const value = JSON.parse(raw)
  if (!value.client_email || !value.private_key) throw new Error('Google service account credentials invalid')
  return value as {client_email:string;private_key:string}
}
function encoded(value: unknown) { return Buffer.from(JSON.stringify(value)).toString('base64url') }
export async function googleToken() {
  const creds = credentials(), now = Math.floor(Date.now()/1000)
  const unsigned = `${encoded({alg:'RS256',typ:'JWT'})}.${encoded({iss:creds.client_email,scope:'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})}`
  const signer = createSign('RSA-SHA256'); signer.update(unsigned)
  const assertion = `${unsigned}.${signer.sign(creds.private_key).toString('base64url')}`
  const response = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})})
  const data = await response.json()
  if (!response.ok) throw new Error('Google service account authorization failed')
  return data.access_token as string
}
export async function driveImages() {
  const token = await googleToken()
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('q',`'${folderId}' in parents and mimeType = 'image/jpeg' and trashed = false`)
  url.searchParams.set('fields','nextPageToken,files(id,name,mimeType,webViewLink)')
  url.searchParams.set('pageSize','1000')
  const response = await fetch(url,{headers:{Authorization:`Bearer ${token}`}})
  if (!response.ok) throw new Error(`Drive listing failed: ${response.status}`)
  return (await response.json()).files as {id:string;name:string;webViewLink?:string}[]
}
export async function driveFile(fileId:string) {
  const token = await googleToken()
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,{headers:{Authorization:`Bearer ${token}`}})
  if (!response.ok) throw new Error(`Drive download failed: ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}
export async function driveUploadJpg(name:string, bytes:Buffer) {
  const token=await googleToken()
  const boundary=`mivelle-${crypto.randomUUID()}`
  const metadata=JSON.stringify({name,parents:[folderId],mimeType:'image/jpeg'})
  const payload=Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--`)
  ])
  const response=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':`multipart/related; boundary=${boundary}`},body:Uint8Array.from(payload)})
  if (!response.ok) throw new Error(`Drive photo upload failed: ${response.status}`)
  return (await response.json()).id as string
}
export async function syncPending(limit=20) {
  const token = await googleToken()
  const metadataResponse=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(title))`,{headers:{Authorization:`Bearer ${token}`}})
  if (!metadataResponse.ok) throw new Error(`Tracker access failed: ${metadataResponse.status}`)
  const metadata=await metadataResponse.json()
  if (!(metadata.sheets||[]).some((s:{properties:{title:string}})=>s.properties.title==='App Log')) {
    const created=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requests:[{addSheet:{properties:{title:'App Log'}}}]})})
    if (!created.ok) throw new Error(`Could not create App Log in approved tracker: ${created.status}`)
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/'App Log'!A1:E1?valueInputOption=RAW`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({values:[['Sync ID','Time','Type','Record ID','Snapshot']]})})
  }
  const existingResponse=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/'App Log'!A2:A?majorDimension=COLUMNS`,{headers:{Authorization:`Bearer ${token}`}})
  if (!existingResponse.ok) throw new Error(`Tracker sync lookup failed: ${existingResponse.status}`)
  const existing=new Set<string>((await existingResponse.json()).values?.[0]||[])
  const jobs = await db().sql`SELECT id,kind,entity_id FROM sync_jobs WHERE status IN ('pending','failed') ORDER BY created_at LIMIT ${limit}`
  for (const job of jobs) {
    try {
      if (existing.has(job.id)) { await db().sql`UPDATE sync_jobs SET status='complete' WHERE id=${job.id}`; continue }
      let snapshot:unknown
      if (job.kind==='post') {
        const rows = await db().sql`SELECT po.id,ph.source_file_id,ph.sha256,ph.phash,p.name,p.source_url,po.permalink,po.published_at,po.status FROM posts po JOIN photos ph ON ph.id=po.photo_id JOIN products p ON p.id=ph.product_id WHERE po.id=${job.entity_id}`
        if (!rows[0]) throw new Error('Post record missing')
        snapshot=rows[0]
      } else if (job.kind==='order') {
        const rows = await db().sql`SELECT id,conversation_id,product_id,size,colour,quantity,delivery_location,agreed_amount_ghs,status,approved_by,approved_at FROM orders WHERE id=${job.entity_id}`
        if (!rows[0]) throw new Error('Order record missing')
        snapshot=rows[0]
      } else if (job.kind==='conversation') {
        const rows = await db().sql`SELECT id,handle,status,human_takeover,last_message_at,last_reply_at FROM conversations WHERE id=${job.entity_id}`
        if (!rows[0]) throw new Error('Conversation record missing')
        snapshot=rows[0]
      } else throw new Error('Unknown sync job')
      const target=`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/'App Log'!A:E:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`
      const response=await fetch(target,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({values:[[job.id,new Date().toISOString(),job.kind,job.entity_id,JSON.stringify(snapshot)]]})})
      if (!response.ok) throw new Error(`Sheet append failed: ${response.status}`)
      existing.add(job.id)
      await db().sql`UPDATE sync_jobs SET status='complete',error=NULL WHERE id=${job.id}`
    } catch(error) { await db().sql`UPDATE sync_jobs SET status='failed',error=${String(error)} WHERE id=${job.id}` }
  }
}
