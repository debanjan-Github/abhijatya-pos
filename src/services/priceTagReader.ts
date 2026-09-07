export interface PriceTagDetails {
  name?: string
  barcode?: string
  pricePaise?: number
  rawText: string
}

type BarcodeDetection = { rawValue?: string }
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => { detect(source: ImageBitmapSource): Promise<BarcodeDetection[]> }

const barcodeFormats = ['code_128', 'ean_13', 'upc_a', 'qr_code']

function priceFromText(text: string): number | undefined {
  const labelled = text.match(/(?:mrp|price|rs\.?|₹)\s*[:.-]?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i)
  const candidate = labelled?.[1] ?? text.match(/\b([1-9][0-9]{2,}(?:\.\d{1,2})?)\b/)?.[1]
  if (!candidate) return undefined
  const amount = Number(candidate.replaceAll(',', ''))
  return Number.isFinite(amount) ? Math.round(amount * 100) : undefined
}

function barcodeFromText(text: string): string | undefined {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s/g, '').toUpperCase())
  return lines.find((line) => !/ABHIJATYABOUTIQUE|PRICE|MRP/.test(line) && /^(?:ABH[A-Z0-9-]{3,}|\d{12,13}|[A-Z0-9-]{7,})$/.test(line))
}

function nameFromText(text: string, barcode?: string): string | undefined {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const boutiqueLine = lines.findIndex((line) => /abhijatya\s*boutique/i.test(line))
  if (boutiqueLine >= 0) {
    const nameBelowHeader = lines.slice(boutiqueLine + 1).find((line) => line !== barcode && /[a-z]/i.test(line) && !/(price|mrp|rs\.?|₹|barcode|qty|size)/i.test(line))
    if (nameBelowHeader) return nameBelowHeader
  }
  return lines.find((line) => line !== barcode && /[a-z]/i.test(line) && !/(mrp|price|rs\.?|₹|barcode|qty|size)/i.test(line) && line.replace(/[^a-z]/gi, '').length >= 3)
}

export function extractPriceTagDetails(rawText: string, detectedBarcode?: string): PriceTagDetails {
  const barcode = detectedBarcode ?? barcodeFromText(rawText)
  return { barcode, pricePaise: priceFromText(rawText), name: nameFromText(rawText, barcode), rawText }
}

async function detectBarcode(file: File): Promise<string | undefined> {
  const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector
  if (!Detector) return undefined
  const image = await createImageBitmap(file)
  try {
    return (await new Detector({ formats: barcodeFormats }).detect(image)).find((code) => code.rawValue)?.rawValue
  } finally { image.close() }
}

export async function readPriceTag(file: File): Promise<PriceTagDetails> {
  const detectedBarcode = await detectBarcode(file).catch(() => undefined)
  const { recognize } = await import('tesseract.js')
  const result = await recognize(file, 'eng')
  const rawText = result.data.text
  return extractPriceTagDetails(rawText, detectedBarcode)
}
