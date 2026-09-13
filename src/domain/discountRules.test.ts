import { describe, expect, it } from 'vitest'
import { calculateDiscountPaise, calculateNetPaise } from './discountRules'

describe('discount rules', () => {
  it('calculates amount discounts without going below zero', () => {
    expect(calculateDiscountPaise(10000, { type: 'AMOUNT', value: 1250 })).toBe(1250)
    expect(calculateNetPaise(10000, { type: 'AMOUNT', value: 12500 })).toBe(0)
  })

  it('calculates percentage discounts and caps percentages at 100', () => {
    expect(calculateDiscountPaise(9999, { type: 'PERCENT', value: 10 })).toBe(1000)
    expect(calculateNetPaise(9999, { type: 'PERCENT', value: 150 })).toBe(0)
  })
})
