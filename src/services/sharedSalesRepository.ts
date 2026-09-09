import { supabase } from './supabaseClient'

export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'OTHER'

export interface SaleLineInput { productId: string; quantity: number }

export async function completeSharedSale(items: SaleLineInput[], paymentMethod: PaymentMethod) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.rpc('complete_sale', {
    p_items: items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
    p_payment_method: paymentMethod,
  })
  if (error) throw new Error(error.message)
  const sale = Array.isArray(data) ? data[0] : data
  if (!sale?.invoice_number) throw new Error('Sale was not completed.')
  return { id: sale.sale_id as string, invoiceNumber: sale.invoice_number as string, grandTotalPaise: Number(sale.grand_total_paise) }
}
