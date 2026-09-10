import type { ProductInput } from './types'

export const BARCODE_PATTERN = /^AB\d{5}$/

export function barcodeValidationError(value: string): string | undefined {
  if (!BARCODE_PATTERN.test(value.trim().toUpperCase())) return 'Barcode must be AB followed by exactly 5 numbers (example: AB00021).'
  return undefined
}

export function parseRupees(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return undefined
  return Math.round(amount * 100)
}

export function formatInr(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100)
}

export function validateProduct(input: ProductInput): string[] {
  const errors: string[] = []
  if (!input.name.trim()) errors.push('Product name is required.')
  if (!input.sku.trim()) errors.push('SKU is required.')
  const barcodeError = barcodeValidationError(input.barcode)
  if (barcodeError) errors.push(barcodeError)
  if (!Number.isInteger(input.sellingPricePaise) || input.sellingPricePaise < 0) errors.push('Selling price must be a valid amount.')
  if (!Number.isInteger(input.stockQuantity) || input.stockQuantity < 0) errors.push('Stock quantity must be zero or more.')
  return errors
}
