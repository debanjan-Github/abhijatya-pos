import type { InventoryMovement, MovementType, Product, ProductInput } from '../domain/types'
import { validateProduct } from '../domain/productRules'
import { supabase } from './supabaseClient'

type ProductRow = {
  id: string; name: string; sku: string; barcode: string; zoner: string | null; material: string | null
  selling_price_paise: number; stock_quantity: number; image_path?: string | null; price_tag_image_path?: string | null
  archived_at: string | null; created_at: string; updated_at: string
}

const client = () => {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}
const mapProduct = (row: ProductRow): Product => ({
  id: row.id, name: row.name, sku: row.sku, barcode: row.barcode, zoner: row.zoner ?? undefined, material: row.material ?? undefined,
  sellingPricePaise: Number(row.selling_price_paise), stockQuantity: row.stock_quantity, imageDataUrl: row.image_path ?? undefined,
  priceTagImageDataUrl: row.price_tag_image_path ?? undefined, archivedAt: row.archived_at ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
})
const ensureValid = (input: ProductInput) => {
  const errors = validateProduct(input)
  if (errors.length) throw new Error(errors.join(' '))
}

export const sharedProductRepository = {
  async list(includeArchived = false): Promise<Product[]> {
    // Photo data is intentionally excluded from the shared five-second refresh.
    // Existing records may have phone-photo data URLs, which are far too large to
    // transfer repeatedly to every staff device.
    let query = client().from('products')
      .select('id,name,sku,barcode,zoner,material,selling_price_paise,stock_quantity,archived_at,created_at,updated_at')
      .order('updated_at', { ascending: false })
    if (!includeArchived) query = query.is('archived_at', null)
    const { data, error } = await query
    if (error) throw new Error(error.message)
    return (data as ProductRow[]).map(mapProduct)
  },
  async get(id: string): Promise<Product> {
    const { data, error } = await client().from('products').select('*').eq('id', id).single()
    if (error) throw new Error(error.message)
    return mapProduct(data as ProductRow)
  },
  async getForSale(id: string): Promise<Product> {
    const { data, error } = await client().from('products')
      .select('id,name,sku,barcode,zoner,material,selling_price_paise,stock_quantity,price_tag_image_path,archived_at,created_at,updated_at')
      .eq('id', id)
      .single()
    if (error) throw new Error(error.message)
    return mapProduct(data as ProductRow)
  },
  async create(input: ProductInput): Promise<Product> {
    ensureValid(input)
    const { data, error } = await client().rpc('create_product_with_opening_stock', {
      p_name: input.name, p_sku: input.sku, p_barcode: input.barcode, p_zoner: input.zoner ?? '', p_material: input.material ?? '',
      p_selling_price_paise: input.sellingPricePaise, p_stock_quantity: input.stockQuantity,
      p_image_path: input.imageDataUrl ?? null, p_price_tag_image_path: input.priceTagImageDataUrl ?? null,
    })
    if (error) throw new Error(error.message)
    return mapProduct(data as ProductRow)
  },
  async update(id: string, input: ProductInput): Promise<Product> {
    ensureValid(input)
    const { data, error } = await client().from('products').update({
      name: input.name.trim(), sku: input.sku.trim(), barcode: input.barcode.trim(), zoner: input.zoner?.trim() || null,
      material: input.material?.trim() || null, selling_price_paise: input.sellingPricePaise, image_path: input.imageDataUrl ?? null,
      price_tag_image_path: input.priceTagImageDataUrl ?? null, updated_at: new Date().toISOString(),
    }).eq('id', id).select().single()
    if (error) throw new Error(error.message)
    return mapProduct(data as ProductRow)
  },
  async archive(id: string): Promise<void> {
    const { error } = await client().from('products').update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error(error.message)
  },
  async restore(id: string): Promise<void> {
    const { error } = await client().from('products').update({ archived_at: null, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error(error.message)
  },
  async permanentlyDeleteArchived(id: string): Promise<void> {
    const { error } = await client().rpc('permanently_delete_archived_product', { p_product_id: id })
    if (error) throw new Error(error.message)
  },
  async adjustStock(id: string, newStock: number, type: Exclude<MovementType, 'SALE'>, notes?: string): Promise<Product> {
    const { data, error } = await client().rpc('adjust_product_stock', { p_product_id: id, p_new_stock: newStock, p_type: type, p_notes: notes ?? null })
    if (error) throw new Error(error.message)
    return mapProduct(data as ProductRow)
  },
  async restoreAllStockToOne(): Promise<number> {
    const { data, error } = await client().rpc('restore_all_product_stock')
    if (error) throw new Error(error.message)
    return Number(data ?? 0)
  },
  async movements(productId: string): Promise<InventoryMovement[]> {
    const { data, error } = await client().from('inventory_movements').select('*').eq('product_id', productId).order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []).map((row) => ({ id: row.id, productId: row.product_id, type: row.type as MovementType, quantity: row.quantity, previousStock: row.previous_stock, newStock: row.new_stock, referenceId: row.reference_id ?? undefined, notes: row.notes ?? undefined, createdAt: row.created_at }))
  },
}
