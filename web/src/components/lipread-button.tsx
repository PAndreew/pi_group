import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createDetector, captureFrame, prepareCrops, trackFrames, type CapturedFrame } from '@/lib/lipread-camera'
import { warmLipreader, transcribeLips, type LoadProgress } from '@/lib/lipread-client'
import type { FaceDetector } from '@mediapipe/tasks-vision'
import { activeTenant } from '@/lib/tenant'

type Stage = 'opening' | 'recording' | 'decoding' | 'review' | 'error'
export function LipreadDialog({ onClose, onInsert }: { onClose: () => void; onInsert: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const detector = useRef<Promise<FaceDetector> | null>(null)
  const model = useRef<Promise<void> | null>(null)
  const frames = useRef<CapturedFrame[]>([])
  const recording = useRef(false)
  const alive = useRef(true)
  const raf = useRef(0)
  const [stage, setStage] = useState<Stage>('opening')
  const [error, setError] = useState('')
  const [raw, setRaw] = useState('')
  const [draft, setDraft] = useState('')
  const [stats, setStats] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [modelStatus, setModelStatus] = useState('Preparing model in background…')
  const [work, setWork] = useState('')
  const [correcting, setCorrecting] = useState(false)
  const [correctionEnabled, setCorrectionEnabled] = useState(false)
  const abort = useRef(new AbortController())
  const releaseCamera = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null }

  useEffect(() => {
    let disposed = false
    alive.current = true
    abort.current = new AbortController()
    // Start camera capture immediately, independently of all ML initialization.
    void openCamera(() => disposed)
    let unsubscribe = () => {}
    try {
      const loading = warmLipreader((p: LoadProgress) => {
        if (disposed) return
        setModelStatus(p.phase === 'initializing' ? 'Download complete · initializing model…' : `Downloading model: ${(Number(p.loaded) / 1_000_000).toFixed(0)}${p.total ? ` / ${(p.total / 1_000_000).toFixed(0)}` : ''} MB`)
      })
      unsubscribe = loading.unsubscribe
      model.current = loading.ready
      void loading.ready.then(() => { if (!disposed) setModelStatus('Model ready') }, e => {
        if (!disposed) { setModelStatus('Model unavailable'); setError(`Model could not load: ${e.message}`) }
      })
    } catch (e) { model.current = null; setError(`Model could not load: ${(e as Error).message}`) }
    void fetch('/api/lipread/config', { signal: abort.current.signal }).then(r => r.json()).then(c => { if (!disposed) setCorrectionEnabled(Boolean(c.correction)) }).catch(() => {})
    return () => {
      disposed = true; alive.current = false; recording.current = false; cancelAnimationFrame(raf.current)
      abort.current.abort(); releaseCamera(); frames.current = []; unsubscribe()
      // Keep only the recognition model warm. Never keep the camera or captured images.
      void detector.current?.then(d => d.close(), () => {})
      detector.current = null
    }
  }, [])

  async function openCamera(cancelled: () => boolean = () => !alive.current) {
    setError(''); setStage('opening')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera requires HTTPS or localhost.')
      const capture = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } })
      if (cancelled()) { capture.getTracks().forEach(t => t.stop()); return }
      stream.current = capture
      video.current!.srcObject = capture
      await video.current!.play()
      if (cancelled()) { releaseCamera(); return }
      start()
    } catch (e) { if (!cancelled()) { releaseCamera(); setError((e as Error).message); setStage('error') } }
  }

  const stop = async () => {
    if (!recording.current) return
    recording.current = false; cancelAnimationFrame(raf.current); releaseCamera()
    setStage('decoding'); setWork('Tracking lip movement…')
    const captured = frames.current; frames.current = []
    try {
      if (!model.current) throw new Error('Model unavailable. Close and reopen dictation to retry.')
      if (captured.length < 10) throw new Error('Record at least half a second.')
      const d = await (detector.current ??= createDetector())
      if (!alive.current) return
      await trackFrames(captured, d, () => !alive.current)
      const { pixels, fps, duration } = prepareCrops(captured)
      captured.length = 0
      setStats(`${duration.toFixed(1)}s clip, ${fps.toFixed(0)} fps${fps < 20 ? ' — low frame rate: accuracy may suffer' : ''}`)
      setWork('Waiting for model…')
      await model.current
      if (!alive.current) return
      setWork('Reading lips on this device…')
      const result = await transcribeLips(pixels)
      if (!alive.current) return
      setRaw(result.text); setDraft(result.text); setStats(s => `${s}; inference ${result.seconds.toFixed(1)}s`); setStage('review')
    } catch (e) { if (alive.current) { setError((e as Error).message); setStage('error') } }
    finally { captured.length = 0 }
  }
  function start() {
    frames.current = []; recording.current = true; setElapsed(0); setStage('recording')
    const began = performance.now()
    let previous = -Infinity, videoTime = -1
    const tick = (time: number) => {
      if (!recording.current) return
      try {
        setElapsed((time - began) / 1000)
        if (time - began >= 10_000) { void stop(); return }
        const v = video.current!
        if (time - previous >= 35 && v.currentTime !== videoTime && v.readyState >= 2) {
          frames.current.push(captureFrame(v, null, time)); previous = time; videoTime = v.currentTime
        }
        raf.current = requestAnimationFrame(tick)
      } catch (e) { recording.current = false; releaseCamera(); frames.current = []; setError((e as Error).message); setStage('error') }
    }
    raf.current = requestAnimationFrame(tick)
  }
  const correct = async () => {
    setCorrecting(true); setError('')
    try {
      const response = await fetch('/api/lipread/correct', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pi-Group': '1', 'X-Pi-Tenant': activeTenant() }, body: JSON.stringify({ text: raw }), signal: abort.current.signal })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Correction failed')
      setDraft(result.text)
    } catch (e) { if (!abort.current.signal.aborted) setError((e as Error).message) }
    finally { if (!abort.current.signal.aborted) setCorrecting(false) }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Silent dictation" onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
    <div className="max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-xl bg-background p-4 shadow-xl">
      <div className="flex items-center justify-between"><h2 className="font-semibold">Silent dictation</h2><button autoFocus type="button" aria-label="Close camera" onClick={onClose}><X className="size-5" /></button></div>
      <video ref={video} muted playsInline aria-hidden="true" className="pointer-events-none absolute size-px opacity-0" />
      <div className="flex items-center gap-2 py-4" role="status">
        {stage === 'recording' && <span aria-hidden="true" className="size-3 animate-pulse rounded-full bg-red-500" />}
        <span>{stage === 'opening' ? 'Opening camera…' : stage === 'recording' ? `Recording · ${elapsed.toFixed(0)} / 10s` : stage === 'decoding' ? work : stage === 'review' ? 'Review your draft' : 'Could not transcribe'}</span>
      </div>
      <p className="text-xs text-muted-foreground">Face the front camera. No preview, no microphone; video stays on this device. English · experimental.</p>
      {(stage === 'recording' || stage === 'decoding') && <p data-model-status className="text-xs text-muted-foreground">{modelStatus}</p>}
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {stage === 'recording' && <button type="button" className="rounded border px-3 py-2" onClick={() => void stop()}>Stop & transcribe</button>}
      {(stage === 'review' || stage === 'error') && <button type="button" className="rounded border px-3 py-2" onClick={() => void openCamera()} disabled={correcting}>Record again</button>}
      {stage === 'review' && <>
        <p className="text-xs text-muted-foreground">{stats}</p>
        <details className="text-xs"><summary>Raw model output</summary>{raw || '(No words recognized)'}</details>
        <textarea aria-label="Review dictation" className="min-h-24 w-full rounded border p-2" value={draft} onChange={e => setDraft(e.target.value)} disabled={correcting} />
        {correctionEnabled && <button type="button" className="mr-2 rounded border px-3 py-2" disabled={correcting || !raw} onClick={() => void correct()}>{correcting ? 'Correcting…' : 'Correct with LLM'}</button>}
        <button type="button" className="rounded border px-3 py-2" disabled={correcting || !draft.trim()} onClick={() => { onInsert(draft.trim()); onClose() }}>Use draft</button>
        <p className="text-xs text-muted-foreground">Correction sends only text to the configured LLM. Use draft never sends the message.</p>
      </>}
    </div>
  </div>
}
