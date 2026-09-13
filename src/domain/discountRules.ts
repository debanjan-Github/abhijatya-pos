export type DiscountType = 'AMOUNT' | 'PERCENT'

export interface DiscountInput {
  type: DiscountType
  value: number
}

export function calculateDiscountPaise(basePaise: number, discount: DiscountInput): number {
  const base = Math.max(0, Math.round(basePaise))
  if (!Number.isFinite(discount.value) || discount.value <= 0) return 0
  if (discount.type === 'PERCENT') return Math.min(base, Math.round(base * Math.min(discount.value, 100) / 100))
  return Math.min(base, Math.round(discount.value))
}

export function calculateNetPaise(basePaise: number, discount: DiscountInput): number {
  return Math.max(0, Math.round(basePaise) - calculateDiscountPaise(basePaise, discount))
}
