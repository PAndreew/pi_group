import { useCallback, useEffect, useRef, useState } from 'react'
import type { FaceDetector } from '@mediapipe/tasks-vision'
import { activeTenant } from '@/lib/tenant'
import type { CapturedFrame } from '@/lib/lipread-camera'

export type DictationPhase = 'loading' | 'ready' | 'opening' | 'recording' | 'decoding' | 'unavailable'
type Camera = typeof import('@/lib/lipread-camera')
type Client = typeof import('@/lib/lipread-client')
interface Runtime { camera: Camera; client: Client; detector: FaceDetector }

/** Preload on composer mount; camera permission is requested only on an explicit click. */
export function useSilentDictation(onText: (text: string) => void) {
  const [phase, setPhase] = useState<DictationPhase>('loading')
  const [hint, setHint] = useState('Preparing silent dictation…')
  const [retry, setRetry] = useState(0)
  const runtime = useRef<Runtime | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const frames = useRef<CapturedFrame[]>([])
  const raf = useRef(0)
  const operation = useRef(0)
  const recording = useRef(false)
  const alive = useRef(true)
  const correction = useRef(false)
  const request = useRef<AbortController | null>(null)
  const callback = useRef(onText)
  useEffect(() => { callback.current = onText }, [onText])

  const releaseCamera = useCallback(() => {
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null
    if (video.current) { video.current.pause(); video.current.srcObject = null; video.current.remove(); video.current = null }
  }, [])
  const cancel = useCallback(() => {
    operation.current++; recording.current = false; cancelAnimationFrame(raf.current)
    request.current?.abort(); releaseCamera(); frames.current = []
    if (alive.current) { setPhase(previous => runtime.current ? 'ready' : previous === 'unavailable' ? 'unavailable' : 'loading'); if (runtime.current) setHint('') }
  }, [releaseCamera])

  useEffect(() => {
    let disposed = false
    alive.current = true
    let unsubscribe = () => {}
    setPhase('loading'); setHint('Preparing silent dictation…')
    void (async () => {
      try {
        const [camera, client] = await Promise.all([import('@/lib/lipread-camera'), import('@/lib/lipread-client')])
        if (disposed) return
        const model = client.warmLipreader(progress => {
          if (!disposed && progress.phase === 'download' && progress.total) setHint(`Preparing silent dictation · ${Math.round((progress.loaded ?? 0) / progress.total * 100)}%`)
        })
        unsubscribe = model.unsubscribe
        const [, detector] = await Promise.all([model.ready, camera.warmDetector()])
        if (disposed) return
        runtime.current = { camera, client, detector }
        setPhase('ready'); setHint('')
      } catch (error) {
        if (!disposed) { setPhase('unavailable'); setHint(`Silent dictation unavailable: ${(error as Error).message}. Click to retry.`) }
      }
    })()
    void fetch('/api/lipread/config').then(r => r.json()).then(config => { if (!disposed) correction.current = Boolean(config.correction) }).catch(() => {})
    return () => {
      disposed = true; alive.current = false; operation.current++; recording.current = false
      cancelAnimationFrame(raf.current); request.current?.abort(); releaseCamera(); frames.current = []; unsubscribe()
      // Static model/detector stay warm for this page. No camera or captured images survive.
    }
  }, [retry, releaseCamera])

  async function stop() {
    if (!recording.current || !runtime.current) return
    const id = operation.current, current = runtime.current
    const cancelled = () => !alive.current || operation.current !== id
    recording.current = false; cancelAnimationFrame(raf.current); releaseCamera()
    const captured = frames.current; frames.current = []
    setPhase('decoding'); setHint('Reading lips…')
    try {
      await current.camera.trackFrames(captured, current.detector, cancelled)
      if (cancelled()) return
      const { pixels } = current.camera.prepareCrops(captured)
      captured.length = 0
      const result = await current.client.transcribeLips(pixels)
      if (cancelled()) return
      let text = result.text.trim(), correctionFailed = false
      if (text && correction.current) {
        setHint('Tidying draft…')
        const controller = new AbortController(); request.current = controller
        try {
          const response = await fetch('/api/lipread/correct', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pi-Group': '1', 'X-Pi-Tenant': activeTenant() },
            body: JSON.stringify({ text }), signal: controller.signal,
          })
          const result = await response.json()
          if (!response.ok || typeof result.text !== 'string') throw new Error('Correction unavailable')
          text = result.text.trim()
        } catch { correctionFailed = true }
      }
      if (cancelled()) return
      setPhase('ready')
      if (!text) { setHint('No words recognized. Try again.'); return }
      callback.current(text)
      setHint(correctionFailed ? 'Correction unavailable. Review the raw draft, then send.' : 'Review your draft, then send.')
    } catch (error) {
      if (!cancelled()) { setPhase('ready'); setHint((error as Error).message) }
    } finally { captured.length = 0 }
  }

  async function start() {
    if (!runtime.current) return
    const id = ++operation.current
    const cancelled = () => !alive.current || operation.current !== id
    setPhase('opening'); setHint('Allow the front camera…')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera requires HTTPS or localhost.')
      const capture = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } })
      if (cancelled()) { capture.getTracks().forEach(track => track.stop()); return }
      stream.current = capture
      const element = document.createElement('video')
      element.muted = true; element.playsInline = true; element.setAttribute('aria-hidden', 'true')
      element.className = 'pointer-events-none fixed size-px opacity-0'
      document.body.append(element); video.current = element; element.srcObject = capture
      await element.play()
      if (cancelled()) return
      frames.current = []; recording.current = true; setPhase('recording')
      const began = performance.now()
      let previous = -Infinity, videoTime = -1, seconds = -1
      const tick = (time: number) => {
        if (cancelled() || !recording.current) return
        try {
          const elapsed = Math.floor((time - began) / 1000)
          if (elapsed !== seconds) {
            seconds = elapsed
            setHint(`Recording · ${elapsed}/10s · click Stop when done${correction.current ? ' · LLM text correction enabled' : ''}`)
          }
          if (time - began >= 10_000) { void stop(); return }
          if (time - previous >= 35 && element.currentTime !== videoTime && element.readyState >= 2) {
            frames.current.push(runtime.current!.camera.captureFrame(element, null, time)); previous = time; videoTime = element.currentTime
          }
          raf.current = requestAnimationFrame(tick)
        } catch (error) {
          recording.current = false; releaseCamera(); frames.current = []
          setPhase('ready'); setHint((error as Error).message)
        }
      }
      raf.current = requestAnimationFrame(tick)
    } catch (error) {
      if (!cancelled()) { releaseCamera(); setPhase('ready'); setHint((error as Error).message) }
    }
  }

  return {
    phase, hint, cancel,
    click: () => {
      if (phase === 'unavailable') { setRetry(n => n + 1); return }
      if (phase === 'recording') void stop()
      else if (phase === 'ready') void start()
    },
  }
}
