export type MovementType = 'PURCHASE' | 'SALE' | 'RETURN' | 'ADJUSTMENT' | 'DAMAGE' | 'OPENING_STOCK'

export interface Product {
  id: string
  name: string
  sku: string
  barcode: string
  zoner?: string
  material?: string
  imageDataUrl?: string
  priceTagImageDataUrl?: string
  sellingPricePaise: number
  stockQuantity: number
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

export interface InventoryMovement {
  id: string
  productId: string
  type: MovementType
  quantity: number
  previousStock: number
  newStock: number
  referenceId?: string
  notes?: string
  createdAt: string
}

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'archivedAt'>
