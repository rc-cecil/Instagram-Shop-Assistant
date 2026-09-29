export const ACCOUNT = '_testing.account1'
export const ZONE = 'Africa/Accra'
export const POST_TIMES = ['08:00', '11:45', '15:30', '19:15', '23:00'] as const
export const PAYMENT_NUMBER = '0551203306'
export const USD_TO_GHS = 13
export const MARKUP_USD = 5

export function ghanaTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}
export function ghanaDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
export function postingSlot(date: Date): string | null {
  const time = ghanaTime(date)
  return POST_TIMES.includes(time as typeof POST_TIMES[number]) ? time : null
}
export function sellingPrice(sheinUsd: number, quantity = 1): number {
  if (!Number.isFinite(sheinUsd) || sheinUsd < 0 || !Number.isInteger(quantity) || quantity < 1) throw new Error('Invalid price or quantity')
  return Math.round((sheinUsd + MARKUP_USD) * USD_TO_GHS * quantity * 100) / 100
}
export function mayVerifyPayment(actor: string, owner: string, evidence: boolean): boolean {
  return !!evidence && !!owner && actor.toLowerCase() === owner.toLowerCase()
}
export function normalizeProductId(url: string): string | null {
  const match = new URL(url).pathname.match(/-p-(\d+)\.html$/)
  return match?.[1] ?? null
}
export function replyAllowed(ageHours: number): boolean { return ageHours >= 0 && ageHours < 24 }
export function canSpend(spentCents: number, reservedCents: number, proposedMaxCents: number, capCents = 500): boolean {
  return spentCents + reservedCents + proposedMaxCents <= capCents
}
export function duplicatePhoto(sha: string, perceptual: string | null, existing: { sha256: string; phash: string | null }[]): boolean {
  return existing.some(p => p.sha256 === sha || (perceptual !== null && p.phash !== null && hamming(perceptual, p.phash) <= 4))
}
function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Infinity
  let distance = 0
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    distance += x.toString(2).replace(/0/g, '').length
  }
  return distance
}
