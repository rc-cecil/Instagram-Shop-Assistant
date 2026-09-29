import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { eventId, verifyMetaSignature } from '../netlify/functions/_shared/server'

describe('Meta webhook idempotency', () => {
  it('accepts only the exact signed payload', () => {
    const body = '{"object":"instagram","entry":[]}'
    const signature = `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`
    expect(verifyMetaSignature(body, signature, 'test-secret')).toBe(true)
    expect(verifyMetaSignature(body + ' ', signature, 'test-secret')).toBe(false)
    expect(verifyMetaSignature(body, signature, 'different-secret')).toBe(false)
    expect(verifyMetaSignature(body, null, 'test-secret')).toBe(false)
  })

  it('assigns repeated deliveries the same event ID', () => {
    const message = { mid: 'mid.123', timestamp: 1750000000 }
    expect(eventId(message, 'customer-1')).toBe('mid.123')
    expect(eventId(message, 'customer-1')).toBe(eventId({ ...message }, 'customer-1'))
  })
})
