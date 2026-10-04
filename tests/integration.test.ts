import sharp from 'sharp'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state=vi.hoisted(()=>({engine:null as any,graph:vi.fn(),owner:null as any,render:vi.fn(),store:vi.fn()}))
vi.mock('../server/services/shein',async original=>({...await original<any>(),renderedDetails:(...args:any[])=>state.render(...args)}))
vi.mock('../server/storage',()=>({storage:{put:(...args:any[])=>state.store(...args),get:vi.fn()}}))
vi.mock('../server/services/server',async importOriginal=>({
  ...await importOriginal<any>(),
  db:()=>({sql:async(strings:TemplateStringsArray,...values:any[])=>{
    const query=strings.reduce((s,part,i)=>s+part+(i<values.length?`$${i+1}`:''),'')
    return (await state.engine.query(query,values)).rows
  }}),
  env:(key:string)=>({META_APP_SECRET:'secret',META_VERIFY_TOKEN:'verify',ENABLE_META_DM_SEND:'true',ENABLE_META_PUBLISHING:'true',GONKA_API_KEY:'key',GONKA_INPUT_USD_PER_MILLION:'0.0021',GONKA_OUTPUT_USD_PER_MILLION:'0.0021'} as Record<string,string>)[key]||'',
  owner:async()=>state.owner,
  log:async(kind:string,entityId:string,detail:string)=>state.engine.query('INSERT INTO activity(id,kind,entity_id,detail) VALUES ($1,$2,$3,$4)',[crypto.randomUUID(),kind,entityId,detail]),
  recordUpdate:async(kind:string,entityId:string)=>state.engine.query('INSERT INTO activity(id,kind,entity_id,detail) VALUES ($1,$2,$3,$4)',[crypto.randomUUID(),`${kind}_updated`,entityId,`${kind} record updated in the system`]),
  igCredentials:async()=>({id:'approved-account',token:'test-token'}),
  graph:(...args:any[])=>state.graph(...args)
}))
import webhook from '../server/handlers/meta-webhook'
import api from '../server/handlers/api'
import { postDue } from '../server/services/posting'
import { processPendingReplies } from '../server/services/replies'

beforeAll(async()=>{
  state.engine=new PGlite()
  for(const folder of ['001_initial','004_sync-events','005_photo-captions','007_launch-gate','008_ai-budget','009_conversation-lock','010_multi_shop','011_system_tracking']) {
    await state.engine.exec(readFileSync(new URL(`../server/migrations/${folder}/migration.sql`,import.meta.url),'utf8'))
  }
},30_000)
beforeEach(async()=>{
  await state.engine.exec(`TRUNCATE products,conversations,webhook_events,reply_jobs,ai_usage,ai_budget_months,activity,sync_jobs CASCADE;
    UPDATE settings SET value='{"replies":false,"posting":false}' WHERE key='automation';
    UPDATE settings SET value='{"approved":false}' WHERE key='launch_review';
    DELETE FROM settings WHERE key='instagram_connection';`)
  state.graph.mockReset();state.owner=null;state.render.mockReset();state.render.mockRejectedValue(new Error("SHEIN requires human verification"));state.store.mockReset()
})
const q=async(sql:string)=>state.engine.query(sql)
const event=()=>{
  const raw=JSON.stringify({object:'instagram',entry:[{messaging:[{sender:{id:'customer'},recipient:{id:'approved-account'},timestamp:Date.now(),message:{mid:'mid-1',text:'Hello'}}]}]})
  return new Request('https://shop.test/api/meta/webhook',{method:'POST',body:raw,headers:{'x-hub-signature-256':`sha256=${createHmac('sha256','secret').update(raw).digest('hex')}`}})
}

describe('database and external action boundaries',()=>{
  it('automatically saves a rendered product photo, pads portrait images and reuses it on retry',async()=>{
    state.owner={id:'owner',email:'owner@example.com'}
    state.render.mockResolvedValue({title:'Grey drawstring pants',image:'https://img.ltwebstatic.com/product.jpg'})
    const bytes=await sharp({create:{width:600,height:900,channels:3,background:'#737373'}}).jpeg().toBuffer()
    const network=vi.spyOn(globalThis,'fetch').mockImplementation(async input=>String(input).includes('img.ltwebstatic.com')?new Response(Uint8Array.from(bytes)):new Response('<meta property="og:image" content="https://m.shein.com/logo/192.png">'))
    try {
      const request=()=>api(new Request('https://shop.test/api/app/import-shein',{method:'POST',body:JSON.stringify({url:'https://m.shein.com/Pants-p-43328251.html'})}))
      const result=await (await request()).json()
      expect(result).toMatchObject({title:'Grey drawstring pants',warning:null,photoId:expect.any(String)})
      expect((await q('SELECT status,product_id FROM photos')).rows).toEqual([{status:'needs_review',product_id:'43328251'}])
      expect((await q('SELECT name,approved FROM products')).rows[0]).toEqual({name:'Grey drawstring pants',approved:false})
      const saved=state.store.mock.calls[0][1]
      expect(await sharp(Buffer.from(saved)).metadata()).toMatchObject({format:'jpeg',width:1080,height:1350})
      expect((await (await request()).json()).photoId).toBe(result.photoId)
      expect(state.store).toHaveBeenCalledTimes(1)
    } finally {network.mockRestore()}
  })
  it('tries a saved browser session when SHEIN redirects the static request to verification',async()=>{
    state.owner={id:'owner',email:'owner@example.com'}
    const challenge=new Response('security challenge')
    Object.defineProperty(challenge,'url',{value:'https://m.shein.com/risk/challenge?captcha_type=909'})
    const network=vi.spyOn(globalThis,'fetch').mockResolvedValue(challenge)
    try {
      const response=await api(new Request('https://shop.test/api/app/import-shein',{method:'POST',body:JSON.stringify({url:'https://m.shein.com/Dress-p-483898098.html'})}))
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({productId:'483898098',photoId:null,warning:expect.stringContaining('security verification is active')})
      expect(state.render).toHaveBeenCalledOnce()
      expect((await q("SELECT count(*)::int n FROM products WHERE id='483898098'")).rows[0].n).toBe(1)
    } finally {network.mockRestore()}
  })
  it('continues automatic import when a verified browser session returns product details',async()=>{
    state.owner={id:'owner',email:'owner@example.com'}
    state.render.mockResolvedValue({title:'Verified dress',image:'https://img.ltwebstatic.com/product.jpg'})
    const challenge=new Response('security challenge')
    Object.defineProperty(challenge,'url',{value:'https://m.shein.com/risk/challenge?captcha_type=909'})
    const bytes=await sharp({create:{width:600,height:900,channels:3,background:'#737373'}}).jpeg().toBuffer()
    const network=vi.spyOn(globalThis,'fetch').mockImplementation(async input=>String(input).includes('img.ltwebstatic.com')?new Response(Uint8Array.from(bytes)):challenge)
    try {
      const response=await api(new Request('https://shop.test/api/app/import-shein',{method:'POST',body:JSON.stringify({url:'https://m.shein.com/Dress-p-483898098.html'})}))
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({productId:'483898098',title:'Verified dress',photoId:expect.any(String),warning:null})
      expect(state.render).toHaveBeenCalledOnce()
    } finally {network.mockRestore()}
  })
  it('imports a new SHEIN product for review even if SHEIN blocks fetching, without duplicating or approving it',async()=>{
    state.owner={id:'owner',email:'owner@example.com'}
    const network=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('captcha'))
    try {
      const request=()=>api(new Request('https://shop.test/api/app/import-shein',{method:'POST',body:JSON.stringify({url:'https://m.shein.com/New-Shirt-p-999999.html?ref=test'})}))
      const first=await request()
      expect(first.status).toBe(200)
      expect(await first.json()).toMatchObject({productId:'999999',photoId:null,reviewRequired:true,warning:expect.stringContaining('Product saved')})
      expect((await request()).status).toBe(200)
      expect((await q('SELECT id,approved,stock_status,shein_usd,source_url FROM products')).rows).toEqual([{id:'999999',approved:false,stock_status:'unverified',shein_usd:null,source_url:'https://m.shein.com/New-Shirt-p-999999.html'}])
      expect((await q('SELECT count(*)::int n FROM photos')).rows[0].n).toBe(0)
      const bad=await api(new Request('https://shop.test/api/app/import-shein',{method:'POST',body:JSON.stringify({url:'https://evil.example/New-Shirt-p-1.html'})}))
      expect(bad.status).toBe(500)
      expect(network).toHaveBeenCalledTimes(2)
    } finally {network.mockRestore()}
  })
  it('checks the live Instagram identity and rejects a different account',async()=>{
    state.owner={id:'owner',email:'owner@example.com'}
    const check=()=>api(new Request('https://shop.test/api/app/integration-check',{method:'POST',body:JSON.stringify({service:'instagram'})}))
    state.graph.mockResolvedValueOnce({id:'approved-account',username:'_testing.account1'})
    expect(await (await check()).json()).toEqual({service:'instagram',connected:true,username:'_testing.account1'})
    state.graph.mockResolvedValueOnce({id:'other-account',username:'other'})
    expect((await check()).status).toBe(409)
  })
  it('requires launch review and Instagram connection before enabling both controls',async()=>{
    state.owner={id:'owner',email:'owner@example.com'}
    const enable=()=>api(new Request('https://shop.test/api/app/automation',{method:'POST',body:JSON.stringify({replies:true,posting:true})}))
    expect((await enable()).status).toBe(400)
    await q(`UPDATE settings SET value='{"approved":true}' WHERE key='launch_review'`)
    expect((await enable()).status).toBe(400)
    await q(`INSERT INTO settings(key,value) VALUES ('instagram_connection','{"id":"approved-account"}')`)
    expect((await enable()).status).toBe(200)
    expect((await q("SELECT value FROM settings WHERE key='automation'")).rows[0].value).toEqual({replies:true,posting:true})
  })
  it('tracks an agreed order and evidence internally while leaving payment approval to the owner',async()=>{
    state.owner={id:'owner',email:'owner@example.com'}
    await state.engine.exec(`INSERT INTO products(id,name,source_url,shein_usd,sizes,colours,stock_status,approved) VALUES ('product','Shirt','https://m.shein.com/item-p-1.html',12.4,'["M"]','["Blue"]','available',true);
      INSERT INTO conversations(id) VALUES ('test-customer');`)
    const create=await api(new Request('https://shop.test/api/app/order',{method:'POST',body:JSON.stringify({conversationId:'test-customer',productId:'product',size:'M',colour:'Blue',quantity:2,deliveryLocation:'Test location',agreedAmountGhs:452.4})}))
    expect(create.status).toBe(200)
    const order=await create.json()
    expect(order.amount).toBe(452.4)
    const evidence=await api(new Request('https://shop.test/api/app/payment-evidence',{method:'POST',body:JSON.stringify({orderId:order.id,evidence:'TEST reference only'})}))
    expect(evidence.status).toBe(200)
    expect((await q('SELECT status,approved_by FROM orders')).rows[0]).toEqual({status:'awaiting_owner_verification',approved_by:null})
    expect((await q('SELECT count(*)::int n FROM cart_tasks')).rows[0].n).toBe(0)
    expect((await q('SELECT count(*)::int n FROM sync_jobs')).rows[0].n).toBe(0)
    expect(state.graph).not.toHaveBeenCalled()
  })
  it('loads system tracking and checks the database without Google credentials or requests',async()=>{
    state.owner={id:'owner',email:'owner@example.com'}
    const network=vi.spyOn(globalThis,'fetch')
    try {
      const dashboard=await api(new Request('https://shop.test/api/app/dashboard'))
      expect(dashboard.status).toBe(200)
      const data=await dashboard.json()
      expect(data).not.toHaveProperty('trackerUrl')
      expect(data).not.toHaveProperty('sync')
      const check=await api(new Request('https://shop.test/api/app/integration-check',{method:'POST',body:JSON.stringify({service:'database'})}))
      expect(await check.json()).toEqual({service:'database',connected:true})
      for (const path of ['drive-list','drive-import','sync']) {
        expect((await api(new Request(`https://shop.test/api/app/${path}`,{method:'POST',body:'{}'}))).status).toBe(404)
      }
      expect(network).not.toHaveBeenCalled()
    } finally { network.mockRestore() }
  })
  it('persists duplicate webhook deliveries as one message and job',async()=>{
    const background:Promise<unknown>[]=[]
    const context={waitUntil:(p:Promise<unknown>)=>background.push(p)} as any
    expect((await webhook(event(),context)).status).toBe(200)
    await Promise.all(background)
    expect((await webhook(event(),context)).status).toBe(200)
    await Promise.all(background)
    expect((await q('SELECT count(*)::int n FROM messages')).rows[0].n).toBe(1)
    expect((await q('SELECT count(*)::int n FROM reply_jobs')).rows[0].n).toBe(1)
    expect(state.graph).not.toHaveBeenCalled()
  })
  it('blocks concurrent active jobs for one customer',async()=>{
    await q(`INSERT INTO reply_jobs(id,inbound_meta_id,conversation_id,status) VALUES ('00000000-0000-4000-8000-000000000001','a','customer','processing')`)
    await expect(q(`INSERT INTO reply_jobs(id,inbound_meta_id,conversation_id,status) VALUES ('00000000-0000-4000-8000-000000000002','b','customer','sending')`)).rejects.toThrow()
  })
  it('holds an uncertain publish and never retries it',async()=>{
    await state.engine.exec(`INSERT INTO products(id,name,source_url,approved) VALUES ('product','Verified shirt','https://m.shein.com/item-p-1.html',true);
      INSERT INTO photos(id,product_id,sha256,status,approved_caption) VALUES ('00000000-0000-4000-8000-000000000001','product','sha','approved','Approved caption');`)
    state.graph.mockImplementation(async(path:string)=>{if(path.includes('?fields=id,media_url'))return {data:[]};throw new Error('Connection lost after request')})
    const now=new Date('2026-09-28T08:00:00Z')
    expect(await postDue(now,'https://shop.test',true)).toBe('uncertain')
    const calls=state.graph.mock.calls.length
    expect(await postDue(now,'https://shop.test',true)).toBe('already_handled')
    expect(state.graph.mock.calls.length).toBe(calls)
    expect((await q('SELECT status FROM photos')).rows[0].status).toBe('approved')
  })
  it('requires authenticated owner approval and preserves separate customer tasks',async()=>{
    const request=()=>new Request('https://shop.test/api/app/payment-decision',{method:'POST',body:JSON.stringify({orderId:'ORDER-A',approved:true})})
    expect((await api(request())).status).toBe(401)
    state.owner={id:'owner',email:'owner@example.com'}
    await state.engine.exec(`INSERT INTO products(id,name,source_url) VALUES ('product','Shirt','https://m.shein.com/item-p-1.html');
      INSERT INTO conversations(id) VALUES ('customer-a'),('customer-b');
      INSERT INTO orders(id,conversation_id,product_id,quantity,status,payment_evidence) VALUES
        ('ORDER-A','customer-a','product',1,'awaiting_owner_verification','reference A'),
        ('ORDER-B','customer-b','product',2,'awaiting_owner_verification','reference B');`)
    expect((await api(request())).status).toBe(200)
    expect((await api(request())).status).toBe(400)
    expect((await q('SELECT order_id FROM cart_tasks')).rows).toEqual([{order_id:'ORDER-A'}])
    expect((await q("SELECT status FROM orders WHERE id='ORDER-B'")).rows[0].status).toBe('awaiting_owner_verification')
    expect((await q('SELECT count(*)::int n FROM sync_jobs')).rows[0].n).toBe(0)
    expect((await q("SELECT entity_id FROM activity WHERE kind='order_updated'")).rows).toEqual([{entity_id:'ORDER-A'}])
    expect(state.graph).not.toHaveBeenCalled()
  })
  it('stops AI calls at the cap before contacting the provider',async()=>{
    await state.engine.exec(`UPDATE settings SET value='{"replies":true,"posting":false}' WHERE key='automation';
      INSERT INTO conversations(id,last_message_at) VALUES ('customer',now());
      INSERT INTO messages(id,meta_id,conversation_id,direction,body) VALUES ('00000000-0000-4000-8000-000000000001','a','customer','inbound','Hello');
      INSERT INTO reply_jobs(id,inbound_meta_id,conversation_id) VALUES ('00000000-0000-4000-8000-000000000002','a','customer');
      INSERT INTO ai_budget_months(month_key,spent_cents) VALUES (to_char(now(),'YYYY-MM'),500);`)
    const network=vi.spyOn(globalThis,'fetch')
    await processPendingReplies(1)
    expect(network).not.toHaveBeenCalled();network.mockRestore()
    expect((await q('SELECT status,error FROM reply_jobs')).rows[0]).toMatchObject({status:'waiting_owner',error:'Error: Monthly AI cap reached'})
  })
  it('holds an uncertain payment-instruction send without sending it twice',async()=>{
    await state.engine.exec(`UPDATE settings SET value='{"replies":true,"posting":false}' WHERE key='automation';
      INSERT INTO products(id,name,source_url) VALUES ('product','Shirt','https://m.shein.com/item-p-1.html');
      INSERT INTO conversations(id,last_message_at) VALUES ('customer',now());
      INSERT INTO orders(id,conversation_id,product_id,quantity,agreed_amount_ghs,status) VALUES ('ORDER-A','customer','product',1,226.2,'awaiting_customer_agreement');
      INSERT INTO messages(id,meta_id,conversation_id,direction,body) VALUES ('00000000-0000-4000-8000-000000000001','a','customer','inbound','CONFIRM ORDER-A');
      INSERT INTO reply_jobs(id,inbound_meta_id,conversation_id) VALUES ('00000000-0000-4000-8000-000000000002','a','customer');`)
    state.graph.mockRejectedValue(new Error('Meta connection lost after send'))
    await processPendingReplies(1)
    await processPendingReplies(1)
    expect(state.graph).toHaveBeenCalledTimes(1)
    expect((await q("SELECT status FROM messages WHERE direction='outbound'")).rows[0].status).toBe('uncertain')
    expect((await q('SELECT status FROM reply_jobs')).rows[0].status).toBe('uncertain')
    expect((await q('SELECT status FROM orders')).rows[0].status).toBe('agreed_waiting_payment')
    expect((await q('SELECT count(*)::int n FROM cart_tasks')).rows[0].n).toBe(0)
  })
})
