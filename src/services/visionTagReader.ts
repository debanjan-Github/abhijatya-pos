import { supabase } from './supabaseClient'
import type { PriceTagDetails } from './priceTagReader'

export type VisionTagDetails = PriceTagDetails & {
  aiUsage?: { tokensUsed: number; tokensRemaining: number; tokenBudget: number }
}

export async function readPriceTagWithVision(imageDataUrl: string): Promise<VisionTagDetails> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.functions.invoke('read-price-tag', { body: { imageDataUrl } })
  if (error) {
    const response = (error as unknown as { context?: Response }).context
    const detail = response ? await response.json().catch(() => undefined) as { error?: string } | undefined : undefined
    throw new Error(detail?.error ?? error.message)
  }
  if (data?.error) throw new Error(data.error)
  return {
    name: data.name ?? undefined,
    barcode: data.barcode ?? undefined,
    pricePaise: data.pricePaise ?? undefined,
    rawText: 'Read by vision AI',
    aiUsage: data.aiUsage ? {
      tokensUsed: data.aiUsage.tokensUsed,
      tokensRemaining: data.aiUsage.tokensRemaining,
      tokenBudget: data.aiUsage.tokenBudget,
    } : undefined,
  }
}
