import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createDetector, captureFrame, prepareCrops, type CapturedFrame } from '@/lib/lipread-camera'
import type { FaceDetector } from '@mediapipe/tasks-vision'
import { activeTenant } from '@/lib/tenant'

type Stage = 'loading' | 'ready' | 'recording' | 'decoding' | 'review' | 'error'
export function LipreadDialog({ onClose, onInsert }: { onClose: () => void; onInsert: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const worker = useRef<Worker | null>(null)
  const detector = useRef<FaceDetector | null>(null)
  const frames = useRef<CapturedFrame[]>([])
  const recording = useRef(false)
  const raf = useRef(0)
  const [stage, setStage] = useState<Stage>('loading')
  const [error, setError] = useState('')
  const [raw, setRaw] = useState('')
  const [draft, setDraft] = useState('')
  const [stats, setStats] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [correcting, setCorrecting] = useState(false)
  const [correctionEnabled, setCorrectionEnabled] = useState(false)
  const abort = useRef(new AbortController())

  useEffect(() => {
    let disposed = false
    abort.current = new AbortController()
    let stream: MediaStream | undefined
    const fail = (message: string) => { if (!disposed) { setError(message); setStage('error') } }
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera requires HTTPS or localhost.')
        const assets = await fetch('/lipread/ready.json', { signal: abort.current.signal })
        if (!assets.ok || !(assets.headers.get('content-type') ?? '').includes('json')) throw new Error('Install the optional lip-reading assets first (see docs/lipreading.md).')
        const w = new Worker(new URL('../lib/lipread.worker.ts', import.meta.url), { type: 'module' })
        worker.current = w
        w.onerror = () => fail('Lip-reading worker failed. This browser may not support the model.')
        w.onmessage = (event) => {
          if (disposed) return
          if (event.data.error) return fail(event.data.error)
          if (event.data.ready) start()
          else { setRaw(event.data.text); setDraft(event.data.text); setStats(s => `${s}; inference ${event.data.seconds.toFixed(1)}s`); setStage('review') }
        }
        const d = await createDetector()
        if (disposed) { d.close(); return }
        detector.current = d
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } })
        if (disposed) { stream.getTracks().forEach(t => t.stop()); return }
        video.current!.srcObject = stream
        await video.current!.play()
        w.postMessage({})
        void fetch('/api/lipread/config', { signal: abort.current.signal }).then(r => r.json()).then(c => { if (!disposed) setCorrectionEnabled(Boolean(c.correction)) }).catch(() => {})
      } catch (e) { fail(e instanceof Error ? e.message : String(e)) }
    })()
    return () => {
      disposed = true; recording.current = false; cancelAnimationFrame(raf.current)
      abort.current.abort(); stream?.getTracks().forEach(t => t.stop())
      worker.current?.terminate(); detector.current?.close(); frames.current = []
    }
  }, [])

  const stop = () => {
    if (!recording.current) return
    recording.current = false; cancelAnimationFrame(raf.current)
    setStage('decoding')
    try {
      const { pixels, fps, duration } = prepareCrops(frames.current)
      setStats(`${duration.toFixed(1)}s clip, ${fps.toFixed(0)} fps${fps < 20 ? ' — low frame rate: accuracy may suffer' : ''}`)
      worker.current!.postMessage({ pixels }, [pixels.buffer])
    } catch (e) { setError((e as Error).message); setStage('error') }
    finally { frames.current = [] }
  }
  const start = () => {
    frames.current = []; recording.current = true; setElapsed(0); setStage('recording')
    const began = performance.now()
    let previous = -Infinity, videoTime = -1
    const tick = (time: number) => {
      if (!recording.current) return
      try {
        setElapsed((time - began) / 1000)
        if (time - began >= 10_000) return stop()
        const v = video.current!
        if (time - previous >= 35 && v.currentTime !== videoTime && v.readyState >= 2) {
          frames.current.push(captureFrame(v, detector.current!, time)); previous = time; videoTime = v.currentTime
        }
        raf.current = requestAnimationFrame(tick)
      } catch (e) { recording.current = false; frames.current = []; setError((e as Error).message); setStage('error') }
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
      <div className="flex items-center justify-between"><h2 className="font-semibold">Silent dictation · experimental</h2><button autoFocus type="button" aria-label="Close camera" onClick={onClose}><X className="size-5" /></button></div>
      <p className="text-xs text-muted-foreground">English · 10 seconds maximum. Video stays on this device; no microphone. Recognition can invent or miss words.</p>
      <video ref={video} muted playsInline className="aspect-[4/3] w-full rounded bg-black object-cover" style={{ transform: 'scaleX(-1)' }} />
      <p role="status" className="text-sm">{stage === 'loading' ? 'Loading ~203 MB model on this device…' : stage === 'recording' ? `Mouth your phrase… ${elapsed.toFixed(0)} / 10s` : stage === 'decoding' ? 'Reading lips on this device…' : stage === 'ready' ? 'Face the camera. Ready to record.' : stats}</p>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {(stage === 'ready' || stage === 'review') && <button type="button" className="rounded border px-3 py-2" onClick={start} disabled={correcting}>{stage === 'review' ? 'Record again' : 'Start recording'}</button>}
      {stage === 'recording' && <button type="button" className="rounded border px-3 py-2" onClick={stop}>Stop & transcribe</button>}
      {stage === 'review' && <>
        <details className="text-xs"><summary>Raw model output</summary>{raw || '(No words recognized)'}</details>
        <textarea aria-label="Review dictation" className="min-h-24 w-full rounded border p-2" value={draft} onChange={e => setDraft(e.target.value)} disabled={correcting} />
        {correctionEnabled && <button type="button" className="mr-2 rounded border px-3 py-2" disabled={correcting || !raw} onClick={() => void correct()}>{correcting ? 'Correcting…' : 'Correct with LLM'}</button>}
        <button type="button" className="rounded border px-3 py-2" disabled={correcting || !draft.trim()} onClick={() => { onInsert(draft.trim()); onClose() }}>Use draft</button>
        <p className="text-xs text-muted-foreground">LLM correction sends only the raw text to the configured provider. Use draft inserts text; it never sends the message.</p>
      </>}
    </div>
  </div>
}
