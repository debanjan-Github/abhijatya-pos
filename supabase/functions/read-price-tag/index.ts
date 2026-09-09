const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type ModelTagDetails = { name: string | null; barcode: string | null; price: number | null }
type TagDetails = { name: string | null; barcode: string | null; pricePaise: number | null }
type OpenAIResponse = {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  usage?: { total_tokens?: number; input_tokens?: number; output_tokens?: number }
}
type AiUsage = { tokensUsed: number; tokensRemaining: number; tokenBudget: number }

function getOutputText(response: OpenAIResponse): string {
  const text = response.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === 'output_text')
    ?.text

  if (!text) throw new Error('AI returned no readable tag details.')
  return text
}

async function recordAiUsage(tokensUsed: number): Promise<AiUsage | undefined> {
  const projectUrl = Deno.env.get('SUPABASE_URL')
  const configuredKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>
  const serviceKey = configuredKeys.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!projectUrl || !serviceKey) return undefined

  const response = await fetch(`${projectUrl}/rest/v1/rpc/record_ai_tag_usage`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_tokens_used: tokensUsed }),
  })
  if (!response.ok) return undefined
  const [usage] = await response.json() as Array<{ tokens_used: number; token_budget: number; tokens_remaining: number }>
  if (!usage) return undefined
  return { tokensUsed, tokensRemaining: usage.tokens_remaining, tokenBudget: usage.token_budget }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return Response.json({ error: 'POST required' }, { status: 405, headers: corsHeaders })
  if (!request.headers.get('Authorization')) return Response.json({ error: 'Staff sign-in required' }, { status: 401, headers: corsHeaders })

  try {
    const { imageDataUrl } = await request.json()
    if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) throw new Error('A price-tag image is required.')
    if (imageDataUrl.length > 12_000_000) throw new Error('Photo is too large. Please retake it at a lower resolution.')
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) throw new Error('AI tag reader is not configured.')

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        store: false,
        reasoning: { effort: 'none' },
        max_output_tokens: 250,
        text: { verbosity: 'low' },
        input: [{ role: 'user', content: [
          { type: 'input_text', text: `Read this Abhijatya Boutique saree price tag. Its layout is: heading “Abhijatya Boutique”, next line product name, Code 128 barcode and its printed value, then “Price:”. Rotate the image mentally if needed. Return ONLY valid JSON with exactly three fields: name (string or null), barcode (string or null), price (integer rupees or null). Preserve the printed product name. Barcode normally begins AB; convert letter O to digit 0 only after the AB prefix. “1450/-” means price 1450. If any value is unclear, use null. Never invent a value.` },
          { type: 'input_image', image_url: imageDataUrl, detail: 'high' },
        ] }],
      }),
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`AI request failed (${response.status}): ${detail.slice(0, 500)}`)
    }
    const result = await response.json() as OpenAIResponse
    const parsed = JSON.parse(getOutputText(result)) as ModelTagDetails
    const tokensUsed = result.usage?.total_tokens ?? ((result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0))
    const aiUsage = tokensUsed > 0 ? await recordAiUsage(tokensUsed) : undefined
    const details: TagDetails = {
      name: parsed.name,
      barcode: parsed.barcode,
      pricePaise: parsed.price === null ? null : Math.round(parsed.price * 100),
    }
    return Response.json({ ...details, aiUsage }, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not read the price tag.' }, { status: 400, headers: corsHeaders })
  }
})
