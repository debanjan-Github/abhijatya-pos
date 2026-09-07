import { describe, expect, it } from 'vitest'
import { extractPriceTagDetails } from './priceTagReader'

describe('price-tag text extraction', () => {
  it('uses the line below Abhijatya Boutique as the product name', () => {
    const result = extractPriceTagDetails('Abhijatya Boutique\nPure Kora Banarasi Buta (bp)\nAB00148\nPrice: 9950/-')
    expect(result).toMatchObject({ name: 'Pure Kora Banarasi Buta (bp)', barcode: 'AB00148', pricePaise: 995000 })
  })
})
