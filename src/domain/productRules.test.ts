import { describe, expect, it } from 'vitest'
import { parseRupees, validateProduct } from './productRules'

describe('product rules', () => {
  it('stores rupees precisely as paise', () => expect(parseRupees('7999.50')).toBe(799950))
  it('requires core product fields', () => expect(validateProduct({ name: '', sku: '', barcode: '', sellingPricePaise: -1, stockQuantity: -1 })).toHaveLength(5))
})
