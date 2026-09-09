import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { Html5Qrcode as Html5QrcodeType } from 'html5-qrcode'

interface LiveBarcodeScannerModalProps {
  onDetected: (barcode: string) => void
  onClose: () => void
}

function describeCameraError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/notallowed|permission|denied/i.test(message)) return 'Camera permission was denied. In Safari, tap aA in the address bar → Website Settings → Camera → Allow, then tap Start camera.'
  if (/notreadable|could not start|track start/i.test(message)) return 'The camera is busy or could not start. Close any other app using the camera, then try again.'
  if (/notfound|no camera/i.test(message)) return 'No camera was found on this device.'
  return `Camera could not start: ${message || 'unknown browser error'}`
}

export function LiveBarcodeScannerModal({ onDetected, onClose }: LiveBarcodeScannerModalProps) {
  const scannerId = useId().replaceAll(':', '')
  const scannerRef = useRef<Html5QrcodeType | undefined>(undefined)
  const onDetectedRef = useRef(onDetected)
  const recentlyReadRef = useRef(new Map<string, number>())
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [running, setRunning] = useState(false)

  useEffect(() => { onDetectedRef.current = onDetected }, [onDetected])

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current
    scannerRef.current = undefined
    if (!scanner) return
    await scanner.stop().catch(() => undefined)
    scanner.clear()
  }, [])

  const startScanner = useCallback(async () => {
    if (starting || running) return
    setStarting(true)
    setError('')

    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
      const scanner = new Html5Qrcode(scannerId, {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
      })
      scannerRef.current = scanner

      // iOS is more reliable with the detected rear-camera ID. This request is
      // deliberately made from the user's Start camera tap.
      const cameras = await Html5Qrcode.getCameras()
      if (!cameras.length) throw new Error('No camera found')
      const rearCamera = cameras.find((camera) => /back|rear|environment/i.test(camera.label)) ?? cameras[cameras.length - 1]

      await scanner.start(
        rearCamera.id,
        {
          fps: 10,
          qrbox: { width: 300, height: 150 },
          disableFlip: true,
        },
        (decodedText) => {
          const barcode = decodedText.trim()
          const now = Date.now()
          if (!barcode || (recentlyReadRef.current.get(barcode) ?? 0) > now - 1500) return
          recentlyReadRef.current.set(barcode, now)
          onDetectedRef.current(barcode)
        },
        () => undefined,
      )

      const video = document.querySelector<HTMLVideoElement>(`#${CSS.escape(scannerId)} video`)
      video?.setAttribute('playsinline', 'true')
      video?.setAttribute('webkit-playsinline', 'true')
      video?.setAttribute('muted', 'true')
      setRunning(true)
    } catch (startError) {
      await stopScanner()
      setError(describeCameraError(startError))
    } finally {
      setStarting(false)
    }
  }, [running, scannerId, starting, stopScanner])

  useEffect(() => () => { void stopScanner() }, [stopScanner])

  return <div className="scanner-backdrop" role="presentation">
    <section className="scanner-modal" role="dialog" aria-modal="true" aria-label="Scan barcode">
      <div className="scanner-header"><div><p className="eyebrow">LIVE SCANNER</p><h2>Point at the barcode</h2><p>Products are added automatically after a successful scan.</p></div><button className="secondary" type="button" onClick={onClose}>Close</button></div>
      <div className="scanner-frame" id={scannerId} />
      {!running && <button className="scan scanner-start" type="button" onClick={() => void startScanner()} disabled={starting}>{starting ? 'Starting camera…' : 'Start camera'}</button>}
      {error && <p className="error">{error}</p>}
      <p className="scanner-help">On iPhone, tap Start camera after opening this window. Keep the label steady inside the frame. Camera scanning uses no AI credits.</p>
    </section>
  </div>
}
