// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { LocalProductRepository } from './productRepository'

const saree = { name: 'Kanjivaram Silk Saree', sku: 'ABH-SIL-0001', barcode: 'ABH000001', sellingPricePaise: 799900, stockQuantity: 1 }

describe('LocalProductRepository', () => {
  beforeEach(() => localStorage.clear())

  it('creates a product and records opening stock', () => {
    const repo = new LocalProductRepository()
    const product = repo.create(saree)
    expect(repo.list()).toEqual([expect.objectContaining({ id: product.id, stockQuantity: 1 })])
    expect(repo.movements(product.id)).toEqual([expect.objectContaining({ type: 'OPENING_STOCK', previousStock: 0, newStock: 1 })])
  })

  it('rejects duplicate barcodes', () => {
    const repo = new LocalProductRepository()
    repo.create(saree)
    expect(() => repo.create({ ...saree, sku: 'ABH-SIL-0002' })).toThrow('Barcode already belongs')
  })

  it('records stock adjustments rather than changing stock silently', () => {
    const repo = new LocalProductRepository()
    const product = repo.create(saree)
    const updated = repo.adjustStock(product.id, 3, 'PURCHASE', 'New shipment')
    expect(updated.stockQuantity).toBe(3)
    expect(repo.movements(product.id).find((movement) => movement.type === 'PURCHASE')).toEqual(expect.objectContaining({ quantity: 2, previousStock: 1, newStock: 3 }))
  })
})
