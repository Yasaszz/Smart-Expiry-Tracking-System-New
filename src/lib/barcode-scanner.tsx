import { useEffect, useRef, useState } from 'react'

import { Modal, ErrorNotice, inputClass, buttonClass, secondaryClass } from '../app/layout'

type Detector = { detect: (video: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
export default function BarcodeScanner({
  onScan,
  onClose,
}: {
  onScan: (value: string) => void
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const mounted = useRef(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stream.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])
  useEffect(() => {
    if (!running) return
    let cancelled = false,
      timer = 0
    const Constructor = (window as unknown as { BarcodeDetector: new () => Detector })
      .BarcodeDetector
    const detector = new Constructor()
    const tick = async () => {
      try {
        if (!cancelled && video.current && video.current.readyState >= 2) {
          const results = await detector.detect(video.current)
          if (results[0]?.rawValue && !cancelled) {
            stream.current?.getTracks().forEach((track) => track.stop())
            onScan(results[0].rawValue)
            return
          }
        }
      } catch {
        if (!cancelled)
          setError('Camera scanning failed. Enter the barcode manually or use a USB scanner.')
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), 300)
    }
    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [running, onScan])
  async function start() {
    setError('')
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
      setError(
        'Camera scanning is not supported in this browser. Use manual entry or a USB barcode scanner.'
      )
      return
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      if (!mounted.current) {
        media.getTracks().forEach((track) => track.stop())
        return
      }
      stream.current = media
      if (video.current) {
        video.current.srcObject = media
        await video.current.play()
      }
      setRunning(true)
    } catch {
      setError('Camera access was denied or unavailable. You can still enter the barcode below.')
    }
  }
  return (
    <Modal title="Scan a product barcode" onClose={onClose}>
      <div className="space-y-4">
        <ErrorNotice message={error} />
        <video
          ref={video}
          muted
          playsInline
          className="aspect-video w-full rounded-xl bg-slate-950"
          aria-label="Barcode camera preview"
        />
        <button disabled={running} onClick={() => void start()} className={secondaryClass}>
          {running ? 'Scanning...' : 'Start camera'}
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (manual.trim()) onScan(manual.trim())
          }}
        >
          <label className="block text-[13px] font-medium">
            Manual or USB scanner entry
            <input
              autoFocus
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              maxLength={100}
              required
              className={inputClass}
            />
          </label>
          <button type="submit" className={`${buttonClass} mt-3`}>
            Find product
          </button>
        </form>
      </div>
    </Modal>
  )
}
