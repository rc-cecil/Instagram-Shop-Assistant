export type SheinDetails = { title:string|null; image:string|null }

export function productImage(value:string):string|null {
  try {
    const url=new URL(value.replace(/&amp;/g,'&'),'https://m.shein.com')
    if (url.protocol!=='https:' || !['img.ltwebstatic.com','img.shein.com'].includes(url.hostname)) return null
    if (!/\.(?:jpg|jpeg|png|webp|avif)(?:$|\?)/i.test(url.href) || /logo|banner|icon/i.test(url.pathname)) return null
    return url.href
  } catch { return null }
}

export function staticDetails(html:string):SheinDetails {
  const meta=(name:string)=>{
    for (const tag of html.match(/<meta\b[^>]*>/gi)||[]) {
      const attrs=Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1].toLowerCase(),m[2]]))
      if (attrs.property===name || attrs.name===name) return attrs.content||null
    }
    return null
  }
  let title=meta('og:title'),image=productImage(meta('og:image')||'')
  for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const visit=(value:any):void=>{
        if (!value||typeof value!=='object') return
        if (value['@type']==='Product') {
          title=typeof value.name==='string'?value.name:title
          const images=Array.isArray(value.image)?value.image:[value.image]
          image=images.map((item:any)=>productImage(typeof item==='string'?item:item?.url||'')).find(Boolean)||image
        }
        for (const item of Object.values(value)) if (typeof item==='object') visit(item)
      }
      visit(JSON.parse(script[1]))
    } catch { /* malformed structured data is ignored */ }
  }
  if (!image) title=null // Generic home-page tags do not describe this product.
  return {title,image}
}

export async function renderedDetails(url:string):Promise<SheinDetails> {
  const [{default:puppeteer},{default:chromium}]=await Promise.all([import('puppeteer-core'),import('@sparticuz/chromium')])
  const browser=await puppeteer.launch({args:chromium.args,executablePath:await chromium.executablePath(),headless:'shell',defaultViewport:{width:430,height:900,isMobile:true}})
  try {
    const page=await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request',request=>{
      try {
        const target=new URL(request.url())
        const allowed=target.protocol==='https:' && ['shein.com','ltwebstatic.com'].some(domain=>target.hostname===domain||target.hostname.endsWith(`.${domain}`))
        if (allowed && !['media','font'].includes(request.resourceType())) void request.continue()
        else void request.abort()
      } catch { void request.abort() }
    })
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000})
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('[id^="carousel_image"]')).some(e=>/img\.(ltwebstatic|shein)\.com/.test(e.getAttribute('data-src')||e.getAttribute('src')||'')),{timeout:20000})
    const result=await page.evaluate(()=>({title:document.querySelector('h1')?.textContent?.trim()||document.title,images:Array.from(document.querySelectorAll('[id^="carousel_image"]')).flatMap(e=>[e.getAttribute('data-src')||'',e.getAttribute('src')||''])}))
    const image=result.images.map(productImage).find(Boolean)||null
    if (!image) throw new Error('SHEIN did not expose a product photo')
    return {title:result.title,image}
  } finally { await browser.close() }
}
