export type Point = [number, number]
export type Landmarks = Point[]
// Auto-AVSR preparation/detectors/mediapipe/20words_mean_face.npy (Apache-2.0).
export const REFERENCE: Landmarks = [[102.073943, 94.272304], [156.361305, 93.578156], [129.003738, 135.903430], [129.313373, 157.822996]]

/** Least-squares non-reflecting similarity: x'=a*x-b*y+tx; y'=b*x+a*y+ty. */
export function similarity(source: Landmarks, target = REFERENCE) {
  const mean = (p: Landmarks): Point => [p.reduce((s, v) => s + v[0], 0) / p.length, p.reduce((s, v) => s + v[1], 0) / p.length]
  const s = mean(source), t = mean(target)
  let dot = 0, cross = 0, norm = 0
  source.forEach(([x, y], i) => {
    const sx = x - s[0], sy = y - s[1], tx = target[i][0] - t[0], ty = target[i][1] - t[1]
    dot += sx * tx + sy * ty; cross += sx * ty - sy * tx; norm += sx * sx + sy * sy
  })
  if (norm < 1e-6) throw new Error('Degenerate face landmarks')
  const a = dot / norm, b = cross / norm
  return { a, b, tx: t[0] - a * s[0] + b * s[1], ty: t[1] - b * s[0] - a * s[1] }
}

export function fillLandmarks(input: (Landmarks | null)[]): Landmarks[] {
  const valid = input.flatMap((v, i) => v ? [i] : [])
  if (!valid.length) throw new Error('No face detected. Face the camera in good light.')
  return input.map((v, i) => {
    if (v) return v
    const left = valid.findLast(j => j < i) ?? valid[0]
    const right = valid.find(j => j > i) ?? valid[valid.length - 1]
    const ratio = left === right ? 0 : (i - left) / (right - left)
    return input[left]!.map(([x, y], k) => [x + ratio * (input[right]![k][0] - x), y + ratio * (input[right]![k][1] - y)] as Point)
  })
}

export function smoothLandmarks(all: Landmarks[], i: number): Landmarks {
  const margin = Math.min(6, i, all.length - 1 - i)
  const window = all.slice(i - margin, i + margin + 1)
  const smooth = all[i].map((_, k) => [window.reduce((s, v) => s + v[k][0], 0) / window.length, window.reduce((s, v) => s + v[k][1], 0) / window.length] as Point)
  const offset = [0, 1].map(axis => all[i].reduce((s, v, k) => s + v[axis] - smooth[k][axis], 0) / all[i].length)
  return smooth.map(([x, y]) => [x + offset[0], y + offset[1]])
}

export function decodeCTC(logits: Float32Array, tokens: string[]): string {
  const width = tokens.length
  if (!width || logits.length % width) throw new Error('Unexpected model output')
  let prev = -1
  const pieces: string[] = []
  for (let offset = 0; offset < logits.length; offset += width) {
    let id = 0
    for (let j = 1; j < width; j++) if (logits[offset + j] > logits[offset + id]) id = j
    if (id !== prev && id !== 0 && id !== width - 1) pieces.push(tokens[id])
    prev = id
  }
  return pieces.join('').replaceAll('▁', ' ').trim()
}
