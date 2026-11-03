import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'
import { fillLandmarks, similarity, smoothLandmarks, type Landmarks } from './lipread-math'

export async function createDetector() {
  return FaceDetector.createFromOptions(await FilesetResolver.forVisionTasks('/lipread/mediapipe'), {
    baseOptions: { modelAssetPath: '/lipread/blaze_face_short_range.tflite', delegate: 'CPU' },
    runningMode: 'VIDEO', minDetectionConfidence: 0.5,
  })
}
export interface CapturedFrame { image: ImageData; landmarks: Landmarks | null; time: number }
export function captureFrame(video: HTMLVideoElement, detector: FaceDetector, time: number): CapturedFrame {
  const canvas = document.createElement('canvas')
  canvas.width = 480; canvas.height = 360
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  // Preserve aspect ratio; never stretch widescreen/portrait faces.
  const scale = Math.max(480 / video.videoWidth, 360 / video.videoHeight)
  ctx.drawImage(video, (480 - video.videoWidth * scale) / 2, (360 - video.videoHeight * scale) / 2, video.videoWidth * scale, video.videoHeight * scale)
  const faces = detector.detectForVideo(canvas, time).detections
  const face = faces.sort((a, b) => (b.boundingBox?.width ?? 0) * (b.boundingBox?.height ?? 0) - (a.boundingBox?.width ?? 0) * (a.boundingBox?.height ?? 0))[0]
  const landmarks = face ? face.keypoints.slice(0, 4).map(p => [p.x * 480, p.y * 360] as [number, number]) : null
  return { image: ctx.getImageData(0, 0, 480, 360), landmarks, time }
}

/** 25fps resampling, gap interpolation, ±6-frame smoothing, alignment and 88px crop. */
export function prepareCrops(frames: CapturedFrame[]) {
  if (frames.length < 10) throw new Error('Record at least half a second.')
  const first = frames[0].time, last = frames.at(-1)!.time
  const sampled: CapturedFrame[] = []
  let index = 0
  for (let time = first; time <= last && sampled.length < 250; time += 40) {
    while (index + 1 < frames.length && Math.abs(frames[index + 1].time - time) < Math.abs(frames[index].time - time)) index++
    sampled.push(frames[index])
  }
  const points = fillLandmarks(sampled.map(f => f.landmarks))
  const source = document.createElement('canvas'); source.width = 480; source.height = 360
  const src = source.getContext('2d')!
  const crop = document.createElement('canvas'); crop.width = 88; crop.height = 88
  const ctx = crop.getContext('2d', { willReadFrequently: true })!
  const pixels = new Uint8Array(sampled.length * 88 * 88)
  sampled.forEach((frame, i) => {
    src.putImageData(frame.image, 0, 0)
    const smooth = smoothLandmarks(points, i)
    const { a, b, tx, ty } = similarity(smooth)
    const [mx, my] = smooth[3]
    const cx = a * mx - b * my + tx, cy = b * mx + a * my + ty
    ctx.resetTransform(); ctx.fillStyle = 'black'; ctx.fillRect(0, 0, 88, 88)
    ctx.setTransform(a, b, -b, a, tx - Math.round(cx - 48) - 4, ty - Math.round(cy - 48) - 4)
    ctx.drawImage(source, 0, 0)
    const rgba = ctx.getImageData(0, 0, 88, 88).data
    for (let j = 0; j < 88 * 88; j++) pixels[i * 88 * 88 + j] = Math.round(0.299 * rgba[j * 4] + 0.587 * rgba[j * 4 + 1] + 0.114 * rgba[j * 4 + 2])
  })
  return { pixels, fps: frames.length * 1000 / (last - first + 40), duration: (last - first) / 1000 }
}
