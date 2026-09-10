import { describe, expect, it } from 'vitest'
import { barcodeValidationError, parseRupees, validateProduct } from './productRules'

describe('product rules', () => {
  it('stores rupees precisely as paise', () => expect(parseRupees('7999.50')).toBe(799950))
  it('requires core product fields', () => expect(validateProduct({ name: '', sku: '', barcode: '', sellingPricePaise: -1, stockQuantity: -1 })).toHaveLength(5))
  it('requires AB followed by exactly five numbers', () => {
    expect(barcodeValidationError('AB00021')).toBeUndefined()
    expect(barcodeValidationError('AB0021')).toContain('exactly 5 numbers')
  })
})
