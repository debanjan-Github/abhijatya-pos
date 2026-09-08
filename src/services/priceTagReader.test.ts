import { describe, expect, it } from 'vitest'
import { extractPriceTagDetails } from './priceTagReader'

describe('price-tag text extraction', () => {
  it('uses the line below Abhijatya Boutique as the product name', () => {
    const result = extractPriceTagDetails('Abhijatya Boutique\nPure Kora Banarasi Buta (bp)\nAB00148\nPrice: 9950/-')
    expect(result).toMatchObject({ name: 'Pure Kora Banarasi Buta (bp)', barcode: 'AB00148', pricePaise: 995000 })
  })

  it('corrects common O-versus-0 and split-name OCR errors on these tags', () => {
    const result = extractPriceTagDetails('Abhijatya Boutique\nPur e Rai n Sil k (1P)\nABOOO93\nPrice: 3250/-')
    expect(result).toMatchObject({ name: 'Pure Rain Silk (1P)', barcode: 'AB00093', pricePaise: 325000 })
  })
})
