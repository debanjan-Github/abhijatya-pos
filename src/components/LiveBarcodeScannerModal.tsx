import { useEffect, useId, useRef, useState } from 'react'
import type { Html5Qrcode as Html5QrcodeType } from 'html5-qrcode'

interface LiveBarcodeScannerModalProps {
  onDetected: (barcode: string) => void
  onClose: () => void
}

export function LiveBarcodeScannerModal({ onDetected, onClose }: LiveBarcodeScannerModalProps) {
  const scannerId = useId().replaceAll(':', '')
  const onDetectedRef = useRef(onDetected)
  const recentlyReadRef = useRef(new Map<string, number>())
  const [error, setError] = useState('')

  useEffect(() => { onDetectedRef.current = onDetected }, [onDetected])

  useEffect(() => {
    let active = true
    let scanner: Html5QrcodeType | undefined
    void import('html5-qrcode').then(({ Html5Qrcode, Html5QrcodeSupportedFormats }) => {
      if (!active) return
      scanner = new Html5Qrcode(scannerId, {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
      })
      return scanner.start(
        { facingMode: { ideal: 'environment' } },
        { fps: 12, qrbox: { width: 300, height: 150 }, disableFlip: true },
        (decodedText) => {
          const barcode = decodedText.trim()
          const now = Date.now()
          if (!barcode || (recentlyReadRef.current.get(barcode) ?? 0) > now - 1500) return
          recentlyReadRef.current.set(barcode, now)
          onDetectedRef.current(barcode)
        },
        () => undefined,
      )
    }).catch(() => { if (active) setError('Camera could not start. Allow camera access and try again.') })

    return () => { active = false; void scanner?.stop().catch(() => undefined) }
  }, [scannerId])

  return <div className="scanner-backdrop" role="presentation">
    <section className="scanner-modal" role="dialog" aria-modal="true" aria-label="Scan barcode">
      <div className="scanner-header"><div><p className="eyebrow">LIVE SCANNER</p><h2>Point at the barcode</h2><p>Products are added automatically after a successful scan.</p></div><button className="secondary" type="button" onClick={onClose}>Close</button></div>
      <div className="scanner-frame" id={scannerId} />
      {error && <p className="error">{error}</p>}
      <p className="scanner-help">Keep the label steady inside the frame. Camera scanning uses no AI credits.</p>
    </section>
  </div>
}
