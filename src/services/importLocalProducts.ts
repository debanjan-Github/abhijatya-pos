import { productRepository } from './productRepository'
import { sharedProductRepository } from './sharedProductRepository'

export async function importLocalProducts(): Promise<number> {
  const localProducts = productRepository.list(true)
  const sharedProducts = await sharedProductRepository.list(true)
  const knownBarcodes = new Set(sharedProducts.map((product) => product.barcode.trim().toLowerCase()))
  const knownSkus = new Set(sharedProducts.map((product) => product.sku.trim().toLowerCase()))
  let imported = 0

  for (const product of localProducts) {
    if (knownBarcodes.has(product.barcode.trim().toLowerCase()) || knownSkus.has(product.sku.trim().toLowerCase())) continue
    const input = {
      name: product.name, sku: product.sku, barcode: product.barcode, zoner: product.zoner, material: product.material,
      imageDataUrl: product.imageDataUrl, priceTagImageDataUrl: product.priceTagImageDataUrl,
      sellingPricePaise: product.sellingPricePaise, stockQuantity: product.stockQuantity,
    }
    const created = await sharedProductRepository.create(input)
    if (product.archivedAt) await sharedProductRepository.archive(created.id)
    knownBarcodes.add(created.barcode.trim().toLowerCase())
    knownSkus.add(created.sku.trim().toLowerCase())
    imported += 1
  }
  return imported
}
