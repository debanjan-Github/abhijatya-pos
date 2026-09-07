import type { InventoryMovement, MovementType, Product, ProductInput } from '../domain/types'
import { validateProduct } from '../domain/productRules'

export interface ProductRepository {
  list(includeArchived?: boolean): Product[]
  create(input: ProductInput): Product
  update(id: string, input: ProductInput): Product
  archive(id: string): void
  restore(id: string): void
  adjustStock(id: string, newStock: number, type: Exclude<MovementType, 'SALE'>, notes?: string): Product
  movements(productId: string): InventoryMovement[]
}

const PRODUCTS_KEY = 'abhijatya.products.v1'
const MOVEMENTS_KEY = 'abhijatya.movements.v1'
const read = <T>(key: string): T[] => JSON.parse(localStorage.getItem(key) ?? '[]') as T[]
const write = <T>(key: string, value: T[]) => localStorage.setItem(key, JSON.stringify(value))
const id = () => crypto.randomUUID()

export class LocalProductRepository implements ProductRepository {
  list(includeArchived = false) { return read<Product>(PRODUCTS_KEY).filter((p) => includeArchived || !p.archivedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }
  create(input: ProductInput) {
    this.assertValid(input)
    this.assertUnique(input)
    const now = new Date().toISOString()
    const product: Product = { ...input, id: id(), createdAt: now, updatedAt: now }
    write(PRODUCTS_KEY, [...read<Product>(PRODUCTS_KEY), product])
    if (product.stockQuantity > 0) this.record(product.id, 'OPENING_STOCK', product.stockQuantity, 0, product.stockQuantity, 'Initial product stock')
    return product
  }
  update(productId: string, input: ProductInput) {
    this.assertValid(input)
    const products = read<Product>(PRODUCTS_KEY)
    const product = products.find((item) => item.id === productId)
    if (!product) throw new Error('Product not found.')
    this.assertUnique(input, productId)
    if (input.stockQuantity !== product.stockQuantity) throw new Error('Use Adjust Stock so that every stock change is recorded.')
    const updated: Product = { ...product, ...input, updatedAt: new Date().toISOString() }
    write(PRODUCTS_KEY, products.map((item) => item.id === productId ? updated : item))
    return updated
  }
  archive(productId: string) {
    const products = read<Product>(PRODUCTS_KEY)
    if (!products.some((product) => product.id === productId)) throw new Error('Product not found.')
    const now = new Date().toISOString()
    write(PRODUCTS_KEY, products.map((product) => product.id === productId ? { ...product, archivedAt: now, updatedAt: now } : product))
  }
  restore(productId: string) {
    const products = read<Product>(PRODUCTS_KEY)
    const product = products.find((item) => item.id === productId)
    if (!product) throw new Error('Product not found.')
    write(PRODUCTS_KEY, products.map((item) => item.id === productId ? { ...item, archivedAt: undefined, updatedAt: new Date().toISOString() } : item))
  }
  adjustStock(productId: string, newStock: number, type: Exclude<MovementType, 'SALE'>, notes?: string) {
    if (!Number.isInteger(newStock) || newStock < 0) throw new Error('Stock must be a whole number of zero or more.')
    const products = read<Product>(PRODUCTS_KEY)
    const product = products.find((item) => item.id === productId)
    if (!product) throw new Error('Product not found.')
    const updated = { ...product, stockQuantity: newStock, updatedAt: new Date().toISOString() }
    write(PRODUCTS_KEY, products.map((item) => item.id === productId ? updated : item))
    this.record(productId, type, newStock - product.stockQuantity, product.stockQuantity, newStock, notes)
    return updated
  }
  movements(productId: string) { return read<InventoryMovement>(MOVEMENTS_KEY).filter((m) => m.productId === productId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
  private assertValid(input: ProductInput) { const errors = validateProduct(input); if (errors.length) throw new Error(errors.join(' ')) }
  private assertUnique(input: ProductInput, exceptId?: string) {
    const conflicts = read<Product>(PRODUCTS_KEY).filter((p) => p.id !== exceptId)
    if (conflicts.some((p) => p.barcode.toLowerCase() === input.barcode.trim().toLowerCase())) throw new Error('Barcode already belongs to another product.')
    if (conflicts.some((p) => p.sku.toLowerCase() === input.sku.trim().toLowerCase())) throw new Error('SKU already belongs to another product.')
  }
  private record(productId: string, type: MovementType, quantity: number, previousStock: number, newStock: number, notes?: string) {
    const movement: InventoryMovement = { id: id(), productId, type, quantity, previousStock, newStock, notes, createdAt: new Date().toISOString() }
    write(MOVEMENTS_KEY, [...read<InventoryMovement>(MOVEMENTS_KEY), movement])
  }
}

export const productRepository = new LocalProductRepository()
