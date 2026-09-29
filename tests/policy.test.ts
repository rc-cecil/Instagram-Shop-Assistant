import { describe, expect, it } from 'vitest'
import { canSpend, duplicatePhoto, ghanaTime, mayVerifyPayment, postingSlot, replyAllowed, sellingPrice } from '../shared/policy'

describe('shop boundaries', () => {
  it('uses Ghana time for post slots', () => {
    expect(ghanaTime(new Date('2026-09-28T08:00:00Z'))).toBe('08:00')
    expect(postingSlot(new Date('2026-09-28T11:45:00Z'))).toBe('11:45')
    expect(postingSlot(new Date('2026-09-28T00:00:00Z'))).toBeNull()
  })
  it('prices the verified variant only', () => expect(sellingPrice(12.4, 2)).toBe(452.4))
  it('rejects image copies despite renaming', () => {
    expect(duplicatePhoto('same', null, [{ sha256: 'same', phash: null }])).toBe(true)
    expect(duplicatePhoto('new', '6406173333333248', [{ sha256: 'old', phash: '6406173333333248' }])).toBe(true)
  })
  it('requires owner and evidence to approve payment', () => {
    expect(mayVerifyPayment('customer', 'owner@example.com', true)).toBe(false)
    expect(mayVerifyPayment('owner@example.com', 'owner@example.com', false)).toBe(false)
    expect(mayVerifyPayment('owner@example.com', 'owner@example.com', true)).toBe(true)
  })
  it('holds replies outside the permitted window and enforces AI cap', () => {
    expect(replyAllowed(25)).toBe(false)
    expect(canSpend(480, 10, 20)).toBe(false)
  })
})
