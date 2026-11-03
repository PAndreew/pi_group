import { useCallback, useEffect, useRef, useState } from 'react'
import { activeTenant } from '@/lib/tenant'

export type DictationPhase = 'loading' | 'ready' | 'opening' | 'recording' | 'decoding' | 'unavailable'

/** Browser records only. The separate Pi service keeps every ML model permanently warm. */
export function useSilentDictation(onText: (text: string) => void) {
  const [phase, setPhase] = useState<DictationPhase>('ready')
  const [hint, setHint] = useState('')
  const [retry, setRetry] = useState(0)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const operation = useRef(0)
  const alive = useRef(true)
  const correction = useRef(false)
  const request = useRef<AbortController | null>(null)
  const callback = useRef(onText)
  useEffect(() => { callback.current = onText }, [onText])

  const releaseCamera = useCallback(() => {
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }, [])
  const cancel = useCallback(() => {
    operation.current++; request.current?.abort()
    const current = recorder.current; recorder.current = null
    if (current) {
      current.ondataavailable = null; current.onstop = null; current.onerror = null
      if (current.state !== 'inactive') current.stop()
    }
    releaseCamera()
    if (alive.current) { setPhase('ready'); setHint('') }
  }, [releaseCamera])

  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    const checkedOperation = operation.current
    // Only a tiny health/config request: never download or initialize any browser ML models.
    void fetch('/api/lipread/config', { signal: controller.signal }).then(r => r.json()).then(config => {
      if (controller.signal.aborted) return
      correction.current = Boolean(config.correction)
      if (!config.ready && operation.current === checkedOperation) {
        setPhase('unavailable'); setHint('Pi lip reader is offline or starting. Click to check again.')
      } else if (config.ready) { setPhase(previous => previous === 'unavailable' ? 'ready' : previous); setHint(previous => previous.startsWith('Pi lip reader is offline') ? '' : previous) }
    }).catch(() => { /* A transient health failure must not disable ordinary recording/typing. */ })
    return () => { controller.abort(); alive.current = false; cancel() }
  }, [retry, cancel])

  async function transcribe(blob: Blob, id: number) {
    const cancelled = () => !alive.current || operation.current !== id
    if (cancelled()) return
    setPhase('decoding'); setHint('Transcribing on Pi…')
    const controller = new AbortController(); request.current = controller
    try {
      const headers = { 'X-Pi-Group': '1', 'X-Pi-Tenant': activeTenant() }
      const response = await fetch('/api/lipread/transcribe', {
        method: 'POST', headers: { ...headers, 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Lip recognition failed')
      if (cancelled()) return
      let text = typeof result.text === 'string' ? result.text.trim() : '', correctionFailed = false
      if (text && correction.current) {
        setHint('Tidying draft…')
        try {
          const corrected = await fetch('/api/lipread/correct', {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }), signal: controller.signal,
          })
          const result = await corrected.json()
          if (!corrected.ok || typeof result.text !== 'string') throw new Error('Correction unavailable')
          text = result.text.trim()
        } catch { correctionFailed = true }
      }
      if (cancelled()) return
      setPhase('ready')
      if (!text) { setHint('No words recognized. Try again.'); return }
      callback.current(text)
      setHint(correctionFailed ? 'Correction unavailable. Review the raw draft, then send.' : 'Review your draft, then send.')
    } catch (error) { if (!cancelled()) { setPhase('ready'); setHint((error as Error).message) } }
  }

  function stop() {
    const current = recorder.current
    if (!current || current.state === 'inactive') return
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    setPhase('decoding'); setHint('Transcribing on Pi…')
    current.stop() // Final dataavailable is emitted before onstop releases the camera and uploads.
  }
  async function start() {
    const id = ++operation.current
    const cancelled = () => !alive.current || operation.current !== id
    setPhase('opening'); setHint('Allow the front camera…')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera requires HTTPS or localhost.')
      if (typeof MediaRecorder === 'undefined') throw new Error('Video recording is not supported by this browser.')
      const capture = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 25 } } })
      if (cancelled()) { capture.getTracks().forEach(track => track.stop()); return }
      stream.current = capture
      const mimeType = ['video/webm;codecs=vp8', 'video/mp4', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type))
      const current = new MediaRecorder(capture, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 1_000_000 })
      recorder.current = current
      const chunks: Blob[] = []
      let bytes = 0
      const began = performance.now()
      current.ondataavailable = event => {
        if (cancelled()) return
        bytes += event.data.size
        if (bytes > 12 * 1024 * 1024) { cancel(); setHint('Recording is too large. Try a shorter clip.'); return }
        if (event.data.size) chunks.push(event.data)
      }
      current.onerror = () => { if (!cancelled()) { cancel(); setHint('Video recording failed. Please try again.') } }
      current.onstop = () => {
        if (cancelled()) return
        recorder.current = null; releaseCamera()
        const blob = new Blob(chunks, { type: current.mimeType || mimeType || 'application/octet-stream' }); chunks.length = 0
        if (performance.now() - began < 500 || !blob.size) { setPhase('ready'); setHint('Record at least half a second.'); return }
        void transcribe(blob, id)
      }
      current.start(250); setPhase('recording')
      const tick = () => {
        if (cancelled() || current.state !== 'recording') return
        const elapsed = Math.floor((performance.now() - began) / 1000)
        setHint(`Recording · ${elapsed}/10s · click Stop when done${correction.current ? ' · LLM text correction enabled' : ''}`)
        if (elapsed >= 10) stop()
      }
      tick(); timer.current = setInterval(tick, 250)
    } catch (error) {
      if (!cancelled()) { cancel(); setHint((error as Error).message) }
    }
  }

  return { phase, hint, cancel, click: () => {
    if (phase === 'unavailable') { setRetry(n => n + 1); return }
    if (phase === 'recording') stop()
    else if (phase === 'ready') void start()
  } }
}
