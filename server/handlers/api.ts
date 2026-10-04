import { storage } from '../storage'
import sharp from 'sharp'
import { ACCOUNT, PAYMENT_NUMBER, POST_TIMES, normalizeProductId, sellingPrice } from '../../shared/policy'
import { db, recordUpdate, env, fail, graph, json, log, owner } from '../services/server'
import { assertUniquePhoto, inspectJpg } from '../services/photos'
import { staticDetails, renderedDetails } from '../services/shein'
import { postDue } from '../services/posting'

const respond = (value:unknown) => json(value)
async function body(req:Request) { try { return await req.json() } catch { throw new Error('Invalid JSON body') } }
async function snapshot(shopId='mivelle') {
  const [settings,shops,products,photos,posts,conversations,orders,cart,activity,usage,jobs] = await Promise.all([
    db().sql`SELECT key,value FROM settings WHERE key IN ('automation','ai_cap_cents','shop','instagram_connection','launch_review')`,
    db().sql`SELECT id,name,instagram_username,timezone,payment_number,payment_method,markup_usd,usd_to_ghs,delivery_message,enabled FROM shops ORDER BY created_at`,
    db().sql`SELECT id,name,source_url,description,shein_usd,sizes,colours,stock_status,approved,excluded,note FROM products ORDER BY id`,
    db().sql`SELECT id,product_id,source_file_id,sha256,phash,status,image_url,approved_caption FROM photos WHERE shop_id=${shopId} ORDER BY created_at DESC`,
    db().sql`SELECT id,photo_id,slot_date,slot_time,caption,status,permalink,error FROM posts WHERE shop_id=${shopId} ORDER BY published_at DESC NULLS LAST LIMIT 80`,
    db().sql`SELECT id,handle,status,human_takeover,last_message_at,last_reply_at FROM conversations WHERE shop_id=${shopId} ORDER BY updated_at DESC LIMIT 100`,
    db().sql`SELECT o.*,p.name product_name,p.source_url FROM orders o JOIN products p ON p.id=o.product_id WHERE o.shop_id=${shopId} ORDER BY o.created_at DESC LIMIT 100`,
    db().sql`SELECT c.*,o.product_id,o.size,o.colour,o.quantity,p.source_url FROM cart_tasks c JOIN orders o ON o.id=c.order_id JOIN products p ON p.id=o.product_id WHERE c.shop_id=${shopId} ORDER BY c.created_at DESC`,
    db().sql`SELECT kind,entity_id,detail,created_at FROM activity WHERE shop_id=${shopId} ORDER BY created_at DESC LIMIT 40`,
    db().sql`SELECT COALESCE(SUM(actual_cents),0)::int cents,COALESCE(SUM(estimated_usd),0)::float estimated_usd,COALESCE(SUM(input_tokens),0)::int input_tokens,COALESCE(SUM(output_tokens),0)::int output_tokens FROM ai_usage WHERE shop_id=${shopId} AND created_at >= date_trunc('month',now())`,
    db().sql`SELECT id,conversation_id,status,error,updated_at FROM reply_jobs WHERE shop_id=${shopId} AND status!='complete' ORDER BY updated_at DESC LIMIT 50`
  ])
  const configuration=Object.fromEntries(settings.map(row=>{const s=row as {key:string;value:any};return [s.key,s.key==='instagram_connection'?{connected:true,username:s.value?.username,expiresAt:s.value?.expiresAt}:s.value]}))
  const shop=(shops as any[]).find(item=>item.id===shopId) || shops[0]
  return {shopId,shops,account:shop?.instagram_username||ACCOUNT,configuration,products,photos,posts,conversations,orders,cart,activity,usage:usage[0],jobs,postTimes:POST_TIMES}
}
async function savePhoto(productId:string, jpg:Buffer, sourceFileId:string|null) {
  const product=await db().sql`SELECT id FROM products WHERE id=${productId}`
  if (!product.length) throw new Error('Product not found')
  const data=await inspectJpg(jpg)
  await assertUniquePhoto(data.sha256,data.phash)
  const id=crypto.randomUUID(), blobKey=`photos/${id}.jpg`
  await storage.put(blobKey, jpg)
  await db().sql`INSERT INTO photos(id,product_id,blob_key,source_file_id,sha256,phash,status,image_url) VALUES (${id},${productId},${blobKey},${sourceFileId},${data.sha256},${data.phash},'needs_review',${`/api/media/${id}`})`
  return id
}
async function importShein(link:string) {
  let parsed:URL
  try { parsed=new URL(link.trim()) } catch { throw new Error('Enter a valid SHEIN product URL') }
  if (parsed.protocol!=='https:' || parsed.username || parsed.password || parsed.port || !['m.shein.com','www.shein.com'].includes(parsed.hostname)) throw new Error('Use an HTTPS SHEIN product link from m.shein.com or www.shein.com')
  const productId=normalizeProductId(parsed.href)
  if (!productId) throw new Error('Use the full SHEIN product link containing its product ID')
  const sourceUrl=`${parsed.origin}${parsed.pathname}`
  await db().sql`INSERT INTO products(id,name,source_url) VALUES (${productId},${`SHEIN product ${productId}`},${sourceUrl}) ON CONFLICT(id) DO NOTHING RETURNING id`
  let title:string|null=null,photoId:string|null=null,warning:string|null=null
  try {
    let details:{title:string|null;image:string|null}={title:null,image:null}
    try {
      const response=await fetch(sourceUrl,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(8000)})
      if (response.ok) details=staticDetails(await response.text())
    } catch { /* JavaScript rendering below is also used for unavailable static pages. */ }
    if (!details.image) details=await renderedDetails(parsed.href)
    title=details.title
    if (title) await db().sql`UPDATE products SET name=CASE WHEN approved=false THEN ${title} ELSE name END,description=COALESCE(description,${title}),updated_at=now() WHERE id=${productId}`
    if (!details.image) throw new Error('No product photo was found')
    const imageResponse=await fetch(details.image,{signal:AbortSignal.timeout(15000)})
    if (!imageResponse.ok) throw new Error('Product photo could not be downloaded')
    const bytes=Buffer.from(await imageResponse.arrayBuffer())
    const metadata=await sharp(bytes).metadata()
    if (!metadata.width||!metadata.height) throw new Error('Product photo dimensions unavailable')
    const ratio=metadata.width/metadata.height
    // Pad tall/wide product images, preserving the whole item for Instagram.
    const jpg=await sharp(bytes).rotate().resize({width:1080,height:1350,fit:ratio<0.8||ratio>1.91?'contain':'inside',background:'#ffffff'}).jpeg({quality:90}).toBuffer()
    const fingerprint=await inspectJpg(jpg)
    const prior=await db().sql`SELECT id FROM photos WHERE product_id=${productId} AND sha256=${fingerprint.sha256} LIMIT 1`
    photoId=prior.length?String(prior[0].id):await savePhoto(productId,jpg,null)

  } catch(error) {
    warning=`Product saved. ${error instanceof Error?error.message:'Details could not be downloaded'}. Review the details and upload a JPG in the product library.`
  }
  await log('product_imported',productId,warning || 'SHEIN product saved for owner review')
  return {productId,title,photoId,warning,reviewRequired:true,priceVerified:false,stockVerified:false}
}

export default async function(req:Request) {
  const user=await owner(req)
  if (!user) return fail('Owner sign-in required',401)
  const path=new URL(req.url).pathname.replace(/^\/api\/app\/?/,'')
  try {
    const shopId=req.headers.get('x-shop-id') || 'mivelle'
    if (req.method==='GET' && path==='dashboard') return respond(await snapshot(shopId))
    if (req.method==='GET' && path.startsWith('conversation/')) {
      const id=decodeURIComponent(path.slice('conversation/'.length))
      const messages=await db().sql`SELECT id,meta_id,direction,body,attachment_url,status,created_at FROM messages WHERE conversation_id=${id} ORDER BY created_at`
      return respond({messages})
    }
    if (req.method!=='POST') return fail('Not found',404)
    if (path==='meta-connect') {
      if (!env('META_APP_ID') || !env('META_APP_SECRET')) return fail('Meta app ID and secret are not configured')
      const state=crypto.randomUUID()
      await db().sql`INSERT INTO settings(key,value) VALUES ('oauth_state',${JSON.stringify({state,created:Date.now()})}::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`
      const auth=new URL('https://www.instagram.com/oauth/authorize')
      auth.searchParams.set('client_id',env('META_APP_ID'))
      auth.searchParams.set('redirect_uri',`${new URL(req.url).origin}/api/meta/auth/callback`)
      auth.searchParams.set('response_type','code')
      auth.searchParams.set('scope','instagram_business_basic,instagram_business_manage_messages,instagram_business_content_publish')
      auth.searchParams.set('state',state)
      return respond({url:auth.href})
    }
    if (path==='integration-check') {
      const input=await body(req)
      if (input.service==='instagram') {
        const profile=await graph('me?fields=id,username')
        if (profile.username!==ACCOUNT) return fail('Instagram connection does not match the approved account',409)
        return respond({service:'instagram',connected:true,username:profile.username})
      }
      if (input.service==='gonka') {
        const key=env('GONKA_API_KEY')
        if (!key) return fail('GonkaRouter key is not configured',409)
        const response=await fetch('https://api.gonkarouter.io/v1/models',{headers:{Authorization:`Bearer ${key}`}})
        if (!response.ok) return fail(`GonkaRouter authentication failed (${response.status})`,502)
        const result=await response.json()
        return respond({service:'gonka',connected:true,modelAvailable:Array.isArray(result.data)&&result.data.some((model:{id:string})=>model.id==='MiniMaxAI/MiniMax-M2.7')})
      }
      if (input.service==='database') {
        await db().sql`SELECT 1 FROM products LIMIT 1`
        return respond({service:'database',connected:true})
      }
      return fail('Unknown integration')
    }
    if (path==='automation') {
      const input=await body(req)
      const replies=input.replies===true,posting=input.posting===true
      if (replies||posting) {
        const review=await db().sql`SELECT value FROM settings WHERE key='launch_review'`
        if (!review[0]?.value?.approved) return fail('Finish and approve the supervised live test before enabling automation')
        const connection=await db().sql`SELECT value FROM settings WHERE key='instagram_connection'`
        if (!connection[0]?.value?.id) return fail('Connect the approved Instagram test account first')
        if (replies && !env('GONKA_API_KEY')) return fail('GonkaRouter key is missing')
      }
      await db().sql`UPDATE settings SET value=${JSON.stringify({replies,posting})}::jsonb WHERE key='automation'`
      await log('automation',user.email,`Replies ${replies?'on':'off'}, posting ${posting?'on':'off'}`)
      return respond({replies,posting})
    }
    if (path==='test-post') {
      const result=await postDue(new Date(),new URL(req.url).origin,true)
      if (result!=='published') return fail(`Supervised post did not publish: ${result}`,409)
      return respond({result})
    }
    if (path==='launch-review') {
      const posts=await db().sql`SELECT id FROM posts WHERE slot_time='supervised' AND status='published' LIMIT 1`
      const orders=await db().sql`SELECT id FROM orders WHERE status='awaiting_owner_verification' LIMIT 1`
      if (!posts.length||!orders.length) return fail('One Meta API test post and one order awaiting owner verification are required')
      await db().sql`UPDATE settings SET value=${JSON.stringify({approved:true,approvedBy:user.email,approvedAt:new Date().toISOString()})}::jsonb WHERE key='launch_review'`
      await log('launch_review',user.email,'Owner reviewed post, conversation and proposed schedule')
      return respond({approved:true})
    }
    if (path==='product') {
      const input=await body(req), id=String(input.id||'')
      const current=await db().sql`SELECT id FROM products WHERE id=${id}`
      if (!current.length) return fail('Product not found',404)
      const usd=input.sheinUsd===''||input.sheinUsd==null?null:Number(input.sheinUsd)
      if (usd!==null && (!Number.isFinite(usd)||usd<0)) return fail('Invalid SHEIN USD price')
      await db().sql`UPDATE products SET name=${String(input.name||'')},description=${String(input.description||'')},shein_usd=${usd},sizes=${JSON.stringify(input.sizes||[])}::jsonb,colours=${JSON.stringify(input.colours||[])}::jsonb,stock_status=${String(input.stockStatus||'unverified')},approved=${input.approved===true},excluded=${input.excluded===true},note=${String(input.note||'')},updated_at=now() WHERE id=${id}`
      await log('product_updated',id,'Owner reviewed product details')
      return respond({ok:true})
    }
    if (path==='import-shein') return respond(await importShein(String((await body(req)).url||'')))
    if (path==='photo-upload') {
      const form=await req.formData(),file=form.get('file')
      if (!(file instanceof File)) return fail('JPG file required')
      const id=await savePhoto(String(form.get('productId')),Buffer.from(await file.arrayBuffer()),null)
      return respond({id})
    }
    if (path==='photo-review') {
      const input=await body(req),id=String(input.id||'')
      if (!['approved','excluded'].includes(input.status)) return fail('Invalid photo status')
      const caption=String(input.caption||'').trim()
      if (input.status==='approved' && (!caption || caption.length>2200)) return fail('Review a caption of 1–2200 characters before approval')
      await db().sql`UPDATE photos SET status=${input.status},approved_caption=${caption||null} WHERE id=${id} AND status='needs_review'`
      return respond({ok:true})
    }
    if (path==='conversation-takeover') {
      const input=await body(req)
      await db().sql`UPDATE conversations SET human_takeover=${input.takeover===true},status=${input.takeover===true?'waiting_owner':'active'},updated_at=now() WHERE id=${String(input.id)}`
      return respond({ok:true})
    }
    if (path==='manual-reply') {
      const input=await body(req),id=String(input.conversationId||''),text=String(input.text||'').trim()
      if (!text || text.length>1000) return fail('Reply must be 1–1000 characters')
      if (env('ENABLE_META_DM_SEND') !== 'true') return fail('Outgoing Meta DMs are disabled locally',403)
      const conversation=await db().sql`SELECT last_message_at FROM conversations WHERE id=${id}`
      if (!conversation.length) return fail('Conversation not found',404)
      if (!conversation[0].last_message_at || Date.now()-new Date(conversation[0].last_message_at).getTime()>24*3600000) return fail('Meta response window has expired')
      const last=await db().sql`SELECT body,status FROM messages WHERE conversation_id=${id} AND direction='outbound' ORDER BY created_at DESC LIMIT 1`
      if (last[0]?.body===text && ['sending','sent','uncertain'].includes(last[0].status)) return fail('This reply was already attempted; check Instagram before sending it again')
      const messageId=crypto.randomUUID()
      await db().sql`INSERT INTO messages(id,conversation_id,direction,body,status) VALUES (${messageId},${id},'outbound',${text},'sending')`
      try {
        const result=await graph('{ig}/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient:{id},message:{text}})})
        await db().sql`UPDATE messages SET meta_id=${result.message_id||null},status='sent' WHERE id=${messageId}`
        await db().sql`UPDATE conversations SET status='active',last_reply_at=now(),updated_at=now() WHERE id=${id}`
        await recordUpdate('conversation',id)
        return respond({ok:true})
      } catch(error) {
        await db().sql`UPDATE messages SET status='uncertain' WHERE id=${messageId}`
        await log('reply_uncertain',id,'Manual reply outcome unclear. Check Instagram before retrying.')
        return fail(String(error),502)
      }
    }
    if (path==='order') {
      const input=await body(req), product=await db().sql`SELECT shein_usd,source_url,sizes,colours,approved,excluded,stock_status FROM products WHERE id=${String(input.productId)}`
      if (!product.length || product[0].shein_usd===null || !product[0].approved || product[0].excluded || product[0].stock_status!=='available') return fail('The exact product, price and availability must be approved first')
      if (!input.size||!input.colour||!input.deliveryLocation||!Number.isInteger(Number(input.quantity))||Number(input.quantity)<1) return fail('Size, colour, quantity and delivery location required')
      if (!product[0].sizes.includes(String(input.size)) || !product[0].colours.includes(String(input.colour))) return fail('Size or colour does not match the approved variant')
      const amount=sellingPrice(Number(product[0].shein_usd),Number(input.quantity))
      if (Number(input.agreedAmountGhs)!==amount) return fail('Agreed amount does not match the verified pricing rule')
      const id=`ORD-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomUUID().slice(0,8).toUpperCase()}`
      await db().sql`INSERT INTO orders(id,conversation_id,product_id,size,colour,quantity,delivery_location,item_total_ghs,agreed_amount_ghs,status) VALUES (${id},${String(input.conversationId)},${String(input.productId)},${String(input.size)},${String(input.colour)},${Number(input.quantity)},${String(input.deliveryLocation)},${amount},${amount},'agreed_waiting_payment')`
      await recordUpdate('order',id)
      return respond({id,amount,paymentInstruction:`Please send GH₵${amount.toFixed(2)} by MoMo to ${PAYMENT_NUMBER} for order ${id}. Reply with the transaction reference or a screenshot so payment can be checked. Delivery is expected about two weeks from confirmed payment; you will be contacted when your order is ready.`})
    }
    if (path==='payment-evidence') {
      const input=await body(req),id=String(input.orderId||''),evidence=String(input.evidence||'')
      if (!evidence) return fail('Evidence reference required')
      const updated=await db().sql`UPDATE orders SET payment_evidence=${evidence},status='awaiting_owner_verification' WHERE id=${id} AND status IN ('agreed_waiting_payment','awaiting_payment_evidence') RETURNING id`
      if (!updated.length) return fail('Order is not waiting for payment evidence',409)
      await recordUpdate('order',id)
      return respond({ok:true})
    }
    if (path==='payment-decision') {
      const input=await body(req),id=String(input.orderId||'')
      const rows=await db().sql`SELECT status,payment_evidence FROM orders WHERE id=${id}`
      if (rows[0]?.status!=='awaiting_owner_verification'||!rows[0].payment_evidence) return fail('This order has no reviewable payment evidence')
      if (input.approved===true) {
        await db().sql`UPDATE orders SET status='payment_verified',approved_by=${user.email},approved_at=now() WHERE id=${id} AND status='awaiting_owner_verification'`
        await db().sql`INSERT INTO cart_tasks(id,order_id) VALUES (${crypto.randomUUID()},${id}) ON CONFLICT(order_id) DO NOTHING`
      } else {
        await db().sql`UPDATE orders SET status='payment_rejected',approved_by=${user.email},approved_at=now() WHERE id=${id} AND status='awaiting_owner_verification'`
      }
      await recordUpdate('order',id)
      await log('payment_decision',id,`${input.approved===true?'Approved':'Rejected'} by ${user.email}`)
      return respond({ok:true})
    }
    return fail('Not found',404)
  } catch(error) { return fail(error instanceof Error?error.message:'Unexpected error',500) }
}
