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
  const {default:puppeteer}=await import('puppeteer-core')
  const { existsSync } = await import('node:fs')
  const { mkdir } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  const localChrome=process.env.CHROME_EXECUTABLE_PATH || (process.platform === 'darwin' && existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '')
  const chromium=localChrome ? null : (await import('@sparticuz/chromium')).default
  const profile=resolve(process.env.SHEIN_BROWSER_PROFILE_DIR || 'data/browser/shein-profile')
  if (localChrome) await mkdir(profile,{recursive:true})
  const visible=!!localChrome && process.env.SHEIN_BROWSER_HEADLESS !== 'true'
  let browser
  try { browser=await puppeteer.launch({args:chromium?.args || [],executablePath:localChrome || await chromium!.executablePath(),headless:visible ? false : localChrome ? true : 'shell',userDataDir:localChrome ? profile : undefined,defaultViewport:{width:430,height:900,isMobile:true}}) }
  catch { throw new Error('Local product browser could not start. Check CHROME_EXECUTABLE_PATH and local browser permissions.') }
  try {
    const page=await browser.newPage()
    if (!visible) {
      await page.setRequestInterception(true)
      page.on('request',request=>{
        try {
          const target=new URL(request.url())
          const allowed=target.protocol==='https:' && ['shein.com','ltwebstatic.com'].some(domain=>target.hostname===domain||target.hostname.endsWith(`.${domain}`))
          if (allowed && !['media','font'].includes(request.resourceType())) void request.continue()
          else void request.abort()
        } catch { void request.abort() }
      })
    }
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000})
    const challenge=new URL(page.url()).pathname.startsWith('/risk/challenge')
    try {
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('[id^="carousel_image"]')).some(e=>/img\.(ltwebstatic|shein)\.com/.test(e.getAttribute('data-src')||e.getAttribute('src')||'')),{timeout:challenge && visible ? 120000 : 20000})
    } catch {
      if (challenge || new URL(page.url()).pathname.startsWith('/risk/challenge')) throw new Error('SHEIN security verification is still active in the product browser. Complete it there and retry the import; the browser session is saved.')
      throw new Error('SHEIN did not expose a product photo in the browser')
    }
    const result=await page.evaluate(()=>({title:document.querySelector('h1')?.textContent?.trim()||document.title,images:Array.from(document.querySelectorAll('[id^="carousel_image"]')).flatMap(e=>[e.getAttribute('data-src')||'',e.getAttribute('src')||''])}))
    const image=result.images.map(productImage).find(Boolean)||null
    if (!image) throw new Error('SHEIN did not expose a product photo')
    return {title:result.title,image}
  } finally { await browser.close() }
}
