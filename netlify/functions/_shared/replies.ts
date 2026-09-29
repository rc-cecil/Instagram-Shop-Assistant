import { PAYMENT_NUMBER, replyAllowed, sellingPrice } from '../../../shared/policy'
import { db, env, graph, log, recordUpdate } from './server'

type Job = { id: string; inbound_meta_id: string; conversation_id: string }
type Product = { id: string; name: string; source_url: string; description: string | null; shein_usd: number | null; stock_status: string; sizes: string[]; colours: string[]; approved: boolean }
type Draft = { productId:string; size:string; colour:string; quantity:number; deliveryLocation:string }

async function claim(): Promise<Job | undefined> {
  const rows = await db().sql`UPDATE reply_jobs SET status='processing',updated_at=now() WHERE id=(SELECT candidate.id FROM reply_jobs candidate WHERE candidate.status='pending' AND NOT EXISTS (SELECT 1 FROM reply_jobs busy WHERE busy.conversation_id=candidate.conversation_id AND busy.status IN ('processing','sending','uncertain')) ORDER BY candidate.updated_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,inbound_meta_id,conversation_id`
  return rows[0] as Job | undefined
}
async function hold(job: Job, reason: string) {
  await db().sql`UPDATE reply_jobs SET status='waiting_owner',error=${reason},updated_at=now() WHERE id=${job.id}`
  await db().sql`UPDATE conversations SET status='waiting_owner',updated_at=now() WHERE id=${job.conversation_id}`
  await log('reply_held',job.conversation_id,reason)
}
async function agreedOrderReply(conversationId:string, incoming:string):Promise<string|null> {
  const orders=await db().sql`SELECT o.*,p.name,p.source_url FROM orders o JOIN products p ON p.id=o.product_id WHERE o.conversation_id=${conversationId} AND o.status IN ('awaiting_customer_agreement','agreed_waiting_payment','awaiting_payment_evidence','awaiting_owner_verification','payment_verified') ORDER BY o.created_at DESC LIMIT 1`
  if (!orders[0]) return null
  const order=orders[0]
  if (order.status==='awaiting_customer_agreement' && incoming.trim().toUpperCase()===`CONFIRM ${order.id}`) {
    await db().sql`UPDATE orders SET status='agreed_waiting_payment' WHERE id=${order.id} AND status='awaiting_customer_agreement'`
    await db().sql`UPDATE conversations SET status='waiting_payment' WHERE id=${conversationId}`
    await recordUpdate('order',order.id)
    return `Please send GH₵${Number(order.agreed_amount_ghs).toFixed(2)} by MoMo to ${PAYMENT_NUMBER} for order ${order.id}. Reply with a transaction reference or screenshot for the owner to check. Delivery is expected about two weeks from confirmed payment; you will be contacted when ready.`
  }
  if (order.status==='awaiting_owner_verification') return `Payment evidence for ${order.id} is waiting for the owner's account check. We will update you after verification.`
  if (order.status==='payment_verified') return `Payment for ${order.id} was confirmed by the owner. Delivery is expected about two weeks from confirmed payment, and you will be contacted when ready.`
  return null
}
async function prepareAgreement(conversationId:string,draft:Draft,products:Product[]):Promise<string> {
  const product=products.find(p=>p.id===draft.productId && p.approved)
  if (!product || product.shein_usd===null || product.stock_status!=='available' || !product.sizes.includes(draft.size) || !product.colours.includes(draft.colour) || !Number.isInteger(draft.quantity) || draft.quantity<1 || draft.quantity>50 || typeof draft.deliveryLocation!=='string' || !draft.deliveryLocation.trim()) throw new Error('Order proposal requires exact owner-approved product details')
  const existing=await db().sql`SELECT id FROM orders WHERE conversation_id=${conversationId} AND status IN ('awaiting_customer_agreement','agreed_waiting_payment','awaiting_payment_evidence','awaiting_owner_verification') LIMIT 1`
  if (existing.length) throw new Error('An open order already exists; owner must review changes before another order')
  const id=`ORD-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomUUID().slice(0,8).toUpperCase()}`
  const amount=sellingPrice(Number(product.shein_usd),draft.quantity)
  await db().sql`INSERT INTO orders(id,conversation_id,product_id,size,colour,quantity,delivery_location,item_total_ghs,agreed_amount_ghs,status) VALUES (${id},${conversationId},${product.id},${draft.size},${draft.colour},${draft.quantity},${draft.deliveryLocation.trim()},${amount},${amount},'awaiting_customer_agreement')`
  await recordUpdate('order',id)
  return `Please confirm ${id}: ${product.name}\n${product.source_url}\nSize: ${draft.size}; colour: ${draft.colour}; quantity: ${draft.quantity}.\nLocation: ${draft.deliveryLocation.trim()}. Item amount: GH₵${amount.toFixed(2)}. Delivery is arranged offline; no delivery charge is included. Expected delivery is about two weeks from confirmed payment. Reply CONFIRM ${id} if these exact details and item amount are agreed.`
}
async function aiReply(conversationId: string, incoming: string, products: Product[]): Promise<{reply:string;orderDraft?:Draft}> {
  const key = env('GONKA_API_KEY')
  if (!key) throw new Error('GonkaRouter key missing')
  const cap = await db().sql`SELECT value FROM settings WHERE key='ai_cap_cents'`
  const inputRate=Number(env('GONKA_INPUT_USD_PER_MILLION')),outputRate=Number(env('GONKA_OUTPUT_USD_PER_MILLION'))
  if (!inputRate || !outputRate || inputRate<0 || outputRate<0) throw new Error('GonkaRouter token rates are not configured')
  if ((32_000*inputRate+1024*outputRate)/1_000_000>0.01) throw new Error('Configured token rates exceed the one-cent call reservation')
  const month=new Date().toISOString().slice(0,7)
  await db().sql`INSERT INTO ai_budget_months(month_key) VALUES (${month}) ON CONFLICT DO NOTHING`
  const reserved=await db().sql`UPDATE ai_budget_months SET reserved_cents=reserved_cents+1 WHERE month_key=${month} AND spent_cents+reserved_cents+1<=${Math.min(500,Number(cap[0]?.value || 500))} RETURNING month_key`
  if (!reserved.length) throw new Error('Monthly AI cap reached')
  const usageId = crypto.randomUUID()
  await db().sql`INSERT INTO ai_usage(id,conversation_id,model,reserved_cents,status) VALUES (${usageId},${conversationId},'MiniMaxAI/MiniMax-M2.7',1,'reserved')`
  try {
    const history = await db().sql`SELECT direction,left(body,1500) body FROM messages WHERE conversation_id=${conversationId} AND body IS NOT NULL ORDER BY created_at DESC LIMIT 12`
    const facts = products.filter(p=>p.approved).map(p => ({id:p.id,name:p.name,url:p.source_url,description:p.description,verifiedPriceGhs:p.shein_usd === null ? null : sellingPrice(Number(p.shein_usd)),sizes:p.sizes,colours:p.colours,stock:p.stock_status}))
    const system = `You are the Instagram shopping assistant for _testing.account1. Reply naturally and briefly in Ghana English. Use ONLY the JSON catalog and policies below. Never invent price, size, colour, stock, discount or delivery charge. If unclear, ask one focused question. Delivery is expected about two weeks from confirmed payment; the owner contacts customers when ready. Never claim payment received or an order placed. Never send payment instructions. Do not promise availability. Return ONLY JSON with reply (string) and optionally orderDraft: {productId,size,colour,quantity,deliveryLocation}. Include orderDraft only when the customer explicitly requested an order and supplied every field; interest is insufficient. Match size and colour exactly to approved catalog values. The server will ask the customer to confirm the exact item amount before payment. Catalog: ${JSON.stringify(facts)}`
    const response = await fetch('https://api.gonkarouter.io/v1/messages',{method:'POST',headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model:'MiniMaxAI/MiniMax-M2.7',max_tokens:1024,system,messages:[{role:'user',content:`Conversation history (oldest first): ${JSON.stringify([...history].reverse())}\nLatest message: ${incoming}`} ]})})
    const data = await response.json()
    if (!response.ok) throw new Error(`GonkaRouter ${response.status}`)
    const text = (data.content || []).filter((b:{type:string})=>b.type==='text').map((b:{text:string})=>b.text).join('').trim()
    if (!text) throw new Error('AI returned no reply')
    const proposed=JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')) as {reply:string;orderDraft?:Draft}
    if (typeof proposed.reply!=='string' || !proposed.reply.trim()) throw new Error('AI reply format invalid')
    if (/0551203306|payment received|payment verified|added to (the )?cart|order placed|send.{0,25}(momo|payment|money)/i.test(proposed.reply)) throw new Error('AI reply crossed a protected action boundary')
    const amounts=[...proposed.reply.matchAll(/(?:GH₵|GHS|GHc|₵|cedis)\s*([\d,.]+)/gi)].map(m=>Number(m[1].replaceAll(',','')))
    const prices=facts.map(f=>f.verifiedPriceGhs).filter(p=>p!==null)
    if (amounts.some(a=>!prices.includes(a))) throw new Error('AI quoted an unapproved amount')
    const urls=proposed.reply.match(/https?:\/\/\S+/g)||[]
    if (urls.some(u=>!facts.some(f=>u===f.url))) throw new Error('AI used an unapproved product link')
    const estimate=((Number(data.usage?.input_tokens||0)*inputRate)+(Number(data.usage?.output_tokens||0)*outputRate))/1_000_000
    if (estimate>0.01) throw new Error('AI call exceeded its one-cent budget reservation; review token rates before replying')
    await db().sql`UPDATE ai_usage SET input_tokens=${data.usage?.input_tokens || 0},output_tokens=${data.usage?.output_tokens || 0},estimated_usd=${estimate},actual_cents=1,reserved_cents=0,status='complete' WHERE id=${usageId}`
    await db().sql`UPDATE ai_budget_months SET reserved_cents=reserved_cents-1,spent_cents=spent_cents+1 WHERE month_key=${month}`
    return {reply:proposed.reply.slice(0,1000),orderDraft:proposed.orderDraft}
  } catch (error) {
    await db().sql`UPDATE ai_usage SET reserved_cents=0,status='failed' WHERE id=${usageId}`
    // Conservatively charge failed or uncertain calls too: the provider may have processed them.
    await db().sql`UPDATE ai_budget_months SET reserved_cents=GREATEST(0,reserved_cents-1),spent_cents=spent_cents+1 WHERE month_key=${month}`
    await db().sql`UPDATE ai_usage SET actual_cents=1 WHERE id=${usageId}`
    throw error
  }
}

export async function processPendingReplies(limit = 5) {
  for (let i=0; i<limit; i++) {
    const job = await claim()
    if (!job) break
    try {
      const config = await db().sql`SELECT value FROM settings WHERE key='automation'`
      if (!config[0]?.value?.replies) { await hold(job,'Automated replies are paused'); continue }
      const conversation = await db().sql`SELECT human_takeover,last_message_at FROM conversations WHERE id=${job.conversation_id}`
      if (conversation[0]?.human_takeover) { await hold(job,'Owner took over this conversation'); continue }
      const incoming = await db().sql`SELECT body,attachment_url FROM messages WHERE meta_id=${job.inbound_meta_id}`
      if (!incoming[0]) { await hold(job,'Inbound message missing'); continue }
      if (!replyAllowed((Date.now()-new Date(conversation[0].last_message_at).getTime())/3600000)) { await hold(job,'Meta response window expired'); continue }
      if (incoming[0].attachment_url) { await hold(job,'Attachment needs owner review; never assume it proves payment'); continue }
      const body = String(incoming[0].body || '')
      if (/\b(paid|payment|momo|transaction|reference)\b/i.test(body)) { await hold(job,'Possible payment message needs owner review'); continue }
      const products = await db().sql`SELECT id,name,source_url,description,shein_usd,stock_status,sizes,colours,approved FROM products WHERE excluded=false` as Product[]
      let reply = await agreedOrderReply(job.conversation_id,body)
      if (!reply) {
        const proposed=await aiReply(job.conversation_id,body,products)
        reply=proposed.orderDraft ? await prepareAgreement(job.conversation_id,proposed.orderDraft,products) : proposed.reply
      }
      const repeated=await db().sql`SELECT id FROM messages WHERE conversation_id=${job.conversation_id} AND direction='outbound' AND body=${reply} AND status IN ('sending','sent','uncertain') LIMIT 1`
      if (repeated.length) { await hold(job,'This reply was already attempted; review conversation before responding'); continue }
      // Reserve the send before the network call. An uncertain Meta response is never retried automatically.
      const outgoingId = crypto.randomUUID()
      await db().sql`INSERT INTO messages(id,conversation_id,direction,body,status) VALUES (${outgoingId},${job.conversation_id},'outbound',${reply},'sending')`
      await db().sql`UPDATE reply_jobs SET status='sending',updated_at=now() WHERE id=${job.id}`
      try {
        const result = await graph('{ig}/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient:{id:job.conversation_id},message:{text:reply}})})
        await db().sql`UPDATE messages SET meta_id=${result.message_id || null},status='sent' WHERE id=${outgoingId}`
        await db().sql`UPDATE reply_jobs SET status='complete',updated_at=now() WHERE id=${job.id}`
        await db().sql`UPDATE conversations SET status=CASE WHEN status IN ('waiting_payment','waiting_owner') THEN status ELSE 'active' END,last_reply_at=now(),updated_at=now() WHERE id=${job.conversation_id}`
        await recordUpdate('conversation',job.conversation_id)
      } catch (error) {
        await db().sql`UPDATE messages SET status='uncertain' WHERE id=${outgoingId}`
        await db().sql`UPDATE reply_jobs SET status='uncertain',error=${String(error)},updated_at=now() WHERE id=${job.id}`
        await log('reply_uncertain',job.conversation_id,'Check Instagram before retrying')
      }
    } catch (error) { await hold(job,String(error)) }
  }
}
