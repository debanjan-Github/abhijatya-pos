import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { Html5Qrcode as Html5QrcodeType } from 'html5-qrcode'

export interface ScannerFeedback {
  message: string
  tone: 'added' | 'duplicate' | 'error'
}

interface LiveBarcodeScannerModalProps {
  onDetected: (barcode: string) => ScannerFeedback | Promise<ScannerFeedback>
  onClose: () => void
}

interface NativeBarcodeScannerPlugin {
  start(): Promise<void>
  stop(): Promise<void>
  setStatus(options: ScannerFeedback): Promise<void>
  addListener(eventName: 'barcodeScanned' | 'scannerClosed', listenerFunc: (event: { barcode?: string }) => void): Promise<PluginListenerHandle>
}

const NativeBarcodeScanner = registerPlugin<NativeBarcodeScannerPlugin>('NativeBarcodeScanner')

function describeCameraError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/notallowed|permission|denied/i.test(message)) return 'Camera permission was denied. Allow camera access in the app or browser settings, then reopen the scanner.'
  if (/notreadable|could not start|track start/i.test(message)) return 'The camera is busy or could not start. Close any other app using the camera, then reopen the scanner.'
  if (/notfound|no camera/i.test(message)) return 'No camera was found on this device.'
  return `Camera could not start: ${message || 'unknown browser error'}`
}

export function LiveBarcodeScannerModal({ onDetected, onClose }: LiveBarcodeScannerModalProps) {
  const scannerId = useId().replaceAll(':', '')
  const scannerRef = useRef<Html5QrcodeType | undefined>(undefined)
  const onDetectedRef = useRef(onDetected)
  const onCloseRef = useRef(onClose)
  const recentlyReadRef = useRef(new Map<string, number>())
  const scanQueueRef = useRef(Promise.resolve())
  const startingRef = useRef(false)
  const startedRef = useRef(false)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [feedback, setFeedback] = useState<ScannerFeedback>({ message: 'Camera is ready. Scan the first barcode.', tone: 'added' })

  useEffect(() => { onDetectedRef.current = onDetected }, [onDetected])
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  const stopScanner = useCallback(async () => {
    startedRef.current = false
    const scanner = scannerRef.current
    scannerRef.current = undefined
    if (!scanner) return
    // html5-qrcode throws synchronously if startup failed before its scanning
    // state was entered. Cleanup must not replace the actual Android camera
    // error with "scanner is not running or paused".
    try {
      await scanner.stop()
    } catch {
      // A scanner that never started has nothing to stop.
    }
    try {
      scanner.clear()
    } catch {
      // The preview may already have been removed by the failed startup.
    }
  }, [])

  const showFeedback = useCallback(async (nextFeedback: ScannerFeedback) => {
    setFeedback(nextFeedback)
    if (Capacitor.isNativePlatform()) await NativeBarcodeScanner.setStatus(nextFeedback).catch(() => undefined)
  }, [])

  const handleDetected = useCallback((value: string) => {
    const barcode = value.trim()
    if (!barcode) return
    const now = Date.now()
    if ((recentlyReadRef.current.get(barcode) ?? 0) > now - 1200) return
    recentlyReadRef.current.set(barcode, now)
    scanQueueRef.current = scanQueueRef.current.then(async () => {
      const nextFeedback = await onDetectedRef.current(barcode)
      await showFeedback(nextFeedback)
    }).catch(() => undefined)
  }, [showFeedback])

  const startNativeScanner = useCallback(async () => {
    // This is an iOS VisionKit scanner, not a JavaScript camera preview. It
    // stays open after each successful Code 128 read for rapid billing.
    await NativeBarcodeScanner.start()
  }, [])

  const startScanner = useCallback(async () => {
    if (startingRef.current || startedRef.current) return
    startingRef.current = true
    setStarting(true)
    setError('')

    try {
      if (Capacitor.isNativePlatform()) {
        await startNativeScanner()
        startedRef.current = true
        return
      }

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

      // Asking for a stream directly triggers the browser permission prompt.
      // On macOS, getCameras()/enumerateDevices can be empty until after that
      // permission exists, which previously made Scan barcode look unresponsive.
      await scanner.start(
        { facingMode: { ideal: 'environment' } },
        {
          fps: 10,
          qrbox: { width: 300, height: 150 },
          disableFlip: true,
        },
        (decodedText) => {
          const barcode = decodedText.trim()
          if (!barcode) return
          handleDetected(barcode)
        },
        () => undefined,
      )

      const video = document.querySelector<HTMLVideoElement>(`#${CSS.escape(scannerId)} video`)
      video?.setAttribute('playsinline', 'true')
      video?.setAttribute('webkit-playsinline', 'true')
      video?.setAttribute('muted', 'true')
      startedRef.current = true
    } catch (startError) {
      await stopScanner()
      setError(describeCameraError(startError))
    } finally {
      startingRef.current = false
      setStarting(false)
    }
  }, [handleDetected, scannerId, startNativeScanner, stopScanner])

  useEffect(() => {
    let active = true
    let nativeBarcodeListener: PluginListenerHandle | undefined
    let nativeCloseListener: PluginListenerHandle | undefined
    const startImmediately = async () => {
      try {
        if (Capacitor.isNativePlatform()) {
          nativeBarcodeListener = await NativeBarcodeScanner.addListener('barcodeScanned', ({ barcode }) => { if (active && barcode) handleDetected(barcode) })
          nativeCloseListener = await NativeBarcodeScanner.addListener('scannerClosed', () => { if (active) onCloseRef.current() })
        }
        if (active) await startScanner()
      } catch (startError) {
        if (active) setError(describeCameraError(startError))
      }
    }
    void startImmediately()
    return () => {
      active = false
      void nativeBarcodeListener?.remove()
      void nativeCloseListener?.remove()
      void stopScanner()
      if (Capacitor.isNativePlatform()) void NativeBarcodeScanner.stop().catch(() => undefined)
    }
  }, [handleDetected, startScanner, stopScanner])

  const close = () => {
    void stopScanner()
    if (Capacitor.isNativePlatform()) void NativeBarcodeScanner.stop().catch(() => undefined)
    onClose()
  }

  if (Capacitor.isNativePlatform()) return null

  return <div className="scanner-backdrop scanner-fullscreen" role="presentation">
    <section className="scanner-modal scanner-fullscreen-modal" role="dialog" aria-modal="true" aria-label="Scan barcode">
      <div className="scanner-frame scanner-fullscreen-frame" id={scannerId} />
      <div className="scanner-fullscreen-header"><div><p className="eyebrow">LIVE SCANNER</p><strong>Point at the barcode</strong><small>Keep scanning — each saree is added automatically.</small></div><button className="secondary" type="button" onClick={close}>Close</button></div>
      <div className="scanner-fullscreen-status">{starting && <p className="notice">Starting camera…</p>}{error && <p className="error">{error}</p>}{!starting && !error && <p className={`scan-feedback ${feedback.tone}`}>{feedback.message}</p>}</div>
    </section>
  </div>
}
