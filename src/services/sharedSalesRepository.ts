import { supabase } from './supabaseClient'

export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'OTHER'

export interface SaleLineInput { productId: string; quantity: number }

export interface SavedSaleItem {
  name: string
  barcode: string
  quantity: number
  unitPricePaise: number
  lineTotalPaise: number
}

export interface SavedSale {
  id: string
  invoiceNumber: string
  totalPaise: number
  paymentMethod: PaymentMethod
  customerPhone?: string
  createdAt: string
  items: SavedSaleItem[]
}

export async function completeSharedSale(items: SaleLineInput[], paymentMethod: PaymentMethod, customerPhone?: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.rpc('complete_sale', {
    p_items: items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
    p_payment_method: paymentMethod,
    p_customer_phone: customerPhone ?? null,
  })
  if (error) throw new Error(error.message)
  const sale = Array.isArray(data) ? data[0] : data
  if (!sale?.invoice_number) throw new Error('Sale was not completed.')
  return { id: sale.sale_id as string, invoiceNumber: sale.invoice_number as string, grandTotalPaise: Number(sale.grand_total_paise) }
}

// A phone number is optional at billing time, so staff can correct it later
// without changing the bill, sale lines, stock, or its permanent bill number.
export async function updateSharedSaleCustomerPhone(saleId: string, customerPhone?: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.rpc('update_sale_customer_phone', {
    p_sale_id: saleId,
    p_customer_phone: customerPhone ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function listSharedSales(limit = 30): Promise<SavedSale[]> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase
    .from('sales')
    .select('id,invoice_number,grand_total_paise,payment_method,customer_phone,created_at,sale_items(product_name_snapshot,barcode_snapshot,quantity,unit_price_paise,line_total_paise)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((sale) => ({
    id: sale.id as string,
    invoiceNumber: sale.invoice_number as string,
    totalPaise: Number(sale.grand_total_paise),
    paymentMethod: sale.payment_method as PaymentMethod,
    customerPhone: (sale.customer_phone as string | null) ?? undefined,
    createdAt: sale.created_at as string,
    items: ((sale.sale_items ?? []) as Array<Record<string, unknown>>).map((item) => ({
      name: item.product_name_snapshot as string,
      barcode: item.barcode_snapshot as string,
      quantity: Number(item.quantity),
      unitPricePaise: Number(item.unit_price_paise),
      lineTotalPaise: Number(item.line_total_paise),
    })),
  }))
}
