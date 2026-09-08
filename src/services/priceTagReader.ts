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
  const match = lines.find((line) => !/ABHIJATYABOUTIQUE|PRICE|MRP/.test(line) && /^(?:ABH[A-Z0-9-]{3,}|AB[0-9O]{3,}|\d{12,13})$/.test(line))
  return match ? normaliseBarcode(match) : undefined
}

function normaliseBarcode(value: string): string {
  const compact = value.replace(/\s/g, '').toUpperCase()
  return /^AB[0-9O]+$/.test(compact) ? `AB${compact.slice(2).replaceAll('O', '0')}` : compact
}

function normaliseName(value: string): string {
  let name = value.replace(/\s+/g, ' ').trim()
  // OCR sometimes reads "Pur e Rai n Sil k" on the dot-matrix price tags.
  while (/\b([A-Za-z]{2,4}) ([a-z])\b/.test(name)) name = name.replace(/\b([A-Za-z]{2,4}) ([a-z])\b/g, '$1$2')
  return name
}

function nameFromText(text: string, barcode?: string): string | undefined {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const boutiqueLine = lines.findIndex((line) => /abhijatya\s*boutique/i.test(line))
  if (boutiqueLine >= 0) {
    const nameBelowHeader = lines.slice(boutiqueLine + 1).find((line) => line !== barcode && /[a-z]/i.test(line) && !/(price|mrp|rs\.?|₹|barcode|qty|size)/i.test(line))
    if (nameBelowHeader) return normaliseName(nameBelowHeader)
  }
  const fallback = lines.find((line) => line !== barcode && /[a-z]/i.test(line) && !/(mrp|price|rs\.?|₹|barcode|qty|size)/i.test(line) && line.replace(/[^a-z]/gi, '').length >= 3)
  return fallback ? normaliseName(fallback) : undefined
}

export function extractPriceTagDetails(rawText: string, detectedBarcode?: string): PriceTagDetails {
  const barcode = detectedBarcode ? normaliseBarcode(detectedBarcode) : barcodeFromText(rawText)
  return { barcode, pricePaise: priceFromText(rawText), name: nameFromText(rawText, barcode), rawText }
}

async function detectBarcode(imageSource: Blob): Promise<string | undefined> {
  const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector
  if (!Detector) return undefined
  const image = await createImageBitmap(imageSource)
  try {
    const code = (await new Detector({ formats: barcodeFormats }).detect(image)).find((result) => result.rawValue)?.rawValue
    return code ? normaliseBarcode(code) : undefined
  } finally { image.close() }
}

async function rotatedCandidates(file: File): Promise<Blob[]> {
  try {
    const image = await createImageBitmap(file)
    const rotations = [0, 90, 270, 180]
    const candidates = await Promise.all(rotations.map(async (rotation) => {
      const sideways = rotation === 90 || rotation === 270
      const canvas = document.createElement('canvas')
      canvas.width = sideways ? image.height : image.width
      canvas.height = sideways ? image.width : image.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Image processing is unavailable.')
      context.filter = 'grayscale(1) contrast(1.7)'
      context.translate(canvas.width / 2, canvas.height / 2)
      context.rotate((rotation * Math.PI) / 180)
      context.drawImage(image, -image.width / 2, -image.height / 2)
      return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Photo could not be prepared.')), 'image/jpeg', 0.92))
    }))
    image.close()
    return candidates
  } catch { return [file] }
}

function quality(details: PriceTagDetails): number {
  return (details.name ? 3 : 0) + (details.barcode ? 3 : 0) + (details.pricePaise ? 2 : 0)
}

export async function readPriceTag(file: File): Promise<PriceTagDetails> {
  const candidates = await rotatedCandidates(file)
  let detectedBarcode: string | undefined
  for (const candidate of candidates) {
    detectedBarcode = await detectBarcode(candidate).catch(() => undefined)
    if (detectedBarcode) break
  }
  const { recognize } = await import('tesseract.js')
  let best: PriceTagDetails = { rawText: '' }
  for (const candidate of candidates) {
    const result = await recognize(candidate, 'eng')
    const details = extractPriceTagDetails(result.data.text, detectedBarcode)
    if (quality(details) > quality(best)) best = details
    if (quality(best) === 8) break
  }
  return best
}
