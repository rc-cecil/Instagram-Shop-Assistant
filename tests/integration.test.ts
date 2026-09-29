import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state=vi.hoisted(()=>({engine:null as any,graph:vi.fn(),owner:null as any}))
vi.mock('../netlify/functions/_shared/server',async importOriginal=>({
  ...await importOriginal<any>(),
  db:()=>({sql:async(strings:TemplateStringsArray,...values:any[])=>{
    const query=strings.reduce((s,part,i)=>s+part+(i<values.length?`$${i+1}`:''),'')
    return (await state.engine.query(query,values)).rows
  }}),
  env:(key:string)=>({META_APP_SECRET:'secret',META_VERIFY_TOKEN:'verify',GONKA_API_KEY:'key',GONKA_INPUT_USD_PER_MILLION:'0.0021',GONKA_OUTPUT_USD_PER_MILLION:'0.0021'} as Record<string,string>)[key]||'',
  owner:async()=>state.owner,
  log:async(kind:string,entityId:string,detail:string)=>state.engine.query('INSERT INTO activity(id,kind,entity_id,detail) VALUES ($1,$2,$3,$4)',[crypto.randomUUID(),kind,entityId,detail]),
  enqueueSync:async(kind:string,entityId:string)=>state.engine.query('INSERT INTO sync_jobs(id,kind,entity_id) VALUES ($1,$2,$3)',[crypto.randomUUID(),kind,entityId]),
  igCredentials:async()=>({id:'approved-account',token:'test-token'}),
  graph:(...args:any[])=>state.graph(...args)
}))
import webhook from '../netlify/functions/meta-webhook'
import api from '../netlify/functions/api'
import { postDue } from '../netlify/functions/_shared/posting'
import { processPendingReplies } from '../netlify/functions/_shared/replies'

beforeAll(async()=>{
  state.engine=new PGlite()
  for(const folder of ['001_initial','004_sync-events','005_photo-captions','007_launch-gate','008_ai-budget','009_conversation-lock']) {
    await state.engine.exec(readFileSync(new URL(`../netlify/database/migrations/${folder}/migration.sql`,import.meta.url),'utf8'))
  }
},30_000)
beforeEach(async()=>{
  await state.engine.exec(`TRUNCATE products,conversations,webhook_events,reply_jobs,ai_usage,ai_budget_months,activity,sync_jobs CASCADE;
    UPDATE settings SET value='{"replies":false,"posting":false}' WHERE key='automation';`)
  state.graph.mockReset();state.owner=null
})
const q=async(sql:string)=>state.engine.query(sql)
const event=()=>{
  const raw=JSON.stringify({object:'instagram',entry:[{messaging:[{sender:{id:'customer'},recipient:{id:'approved-account'},timestamp:Date.now(),message:{mid:'mid-1',text:'Hello'}}]}]})
  return new Request('https://shop.test/api/meta/webhook',{method:'POST',body:raw,headers:{'x-hub-signature-256':`sha256=${createHmac('sha256','secret').update(raw).digest('hex')}`}})
}

describe('database and external action boundaries',()=>{
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
