import { ExternalLink, Globe, Table2, ChartColumn } from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { api, type LinkPreview } from "@/lib/api"
import type { ChartSpec } from "@/lib/rich-blocks"
import { cn } from "@/lib/utils"

function niceTicks(min: number, max: number, count = 4) {
  if (min === max) { max = min + 1; if (min > 0) min = 0 }
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)))
  return ticks
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })
const full = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
/** "€" and "$" lead the number (after its sign); words and "%" follow it. */
const withUnit = (text: string, unit?: string) => {
  if (!unit) return text
  if (unit.length > 2 || /^[a-z%]/i.test(unit)) return unit === "%" ? `${text}%` : `${text} ${unit}`
  return text.startsWith("-") ? `-${unit}${text.slice(1)}` : `${unit}${text}`
}

/** A bar whose data end (the end away from the baseline) is rounded. */
function barPath(x: number, w: number, base: number, end: number, r = 4) {
  const h = Math.abs(base - end)
  r = Math.min(r, w / 2, h)
  if (end <= base) return `M${x},${base}V${end + r}Q${x},${end} ${x + r},${end}H${x + w - r}Q${x + w},${end} ${x + w},${end + r}V${base}Z`
  return `M${x},${base}V${end - r}Q${x},${end} ${x + r},${end}H${x + w - r}Q${x + w},${end} ${x + w},${end - r}V${base}Z`
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

const HEIGHT = 220
const color = (i: number) => `var(--viz-${i + 1})`

export function Chart({ spec }: { spec: ChartSpec }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number>()
  const [table, setTable] = useState(false)
  const { type, x, series, unit, stacked } = spec
  const n = x.length

  const layout = useMemo(() => {
    const values: number[] = []
    if (stacked) {
      for (let j = 0; j < n; j++) {
        let pos = 0, neg = 0
        for (const s of series) { const v = s.data[j] ?? 0; if (v >= 0) pos += v; else neg += v }
        values.push(pos, neg)
      }
    } else for (const s of series) for (const v of s.data) if (v !== null) values.push(v)
    const lo = Math.min(0, ...values)
    const hi = Math.max(...values, lo + 1)
    const ticks = niceTicks(type === "line" && lo >= 0 ? Math.min(...values) : lo, hi)
    const fit = type === "line" && lo >= 0 && ticks[0] > 0 // lines may start above zero; bars always grow from it
    const tickText = ticks.map((t) => withUnit(compact.format(t), unit))
    const left = Math.max(...tickText.map((t) => t.length)) * 6.5 + 10
    const labelled = type === "line" && series.length > 1 && series.length <= 4
    const right = labelled ? Math.min(110, Math.max(...series.map((s) => s.name.length)) * 6.5 + 14) : 12
    return { ticks, tickText, left, right, labelled, min: fit ? ticks[0] : Math.min(0, ticks[0]), max: ticks.at(-1)! }
  }, [series, n, stacked, type, unit])

  const top = 10, bottom = 26
  const plotW = Math.max(40, width - layout.left - layout.right)
  const plotH = HEIGHT - top - bottom
  const y = (v: number) => top + plotH - ((v - layout.min) / (layout.max - layout.min)) * plotH
  const band = plotW / n
  const cx = (j: number) => layout.left + band * j + band / 2
  const base = y(Math.max(layout.min, 0))
  const every = Math.max(1, Math.ceil((Math.max(...x.map((l) => l.length)) * 6.5 + 8) / band))

  const marks: React.ReactNode[] = []
  if (type === "bar" && stacked) {
    const w = Math.min(24, band * 0.6)
    for (let j = 0; j < n; j++) {
      const segs: { i: number; from: number; to: number; v: number }[] = []
      for (let i = 0, pos = 0, neg = 0; i < series.length; i++) {
        const v = series[i].data[j] ?? 0
        const from = v >= 0 ? pos : neg
        if (v >= 0) pos += v; else neg += v
        if (v !== 0) segs.push({ i, from, to: from + v, v })
      }
      const lastPos = segs.findLast((s) => s.v > 0)
      const lastNeg = segs.findLast((s) => s.v < 0)
      for (const s of segs) {
        const y0 = y(s.from), y1 = y(s.to)
        const gap = s.from === 0 ? 0 : 2 // the surface gap between stacked segments
        const start = s.v > 0 ? y0 - gap : y0 + gap
        if (Math.abs(y1 - start) < 0.5) continue
        const d = s === lastPos || s === lastNeg ? barPath(cx(j) - w / 2, w, start, y1) : `M${cx(j) - w / 2},${start}V${y1}H${cx(j) + w / 2}V${start}Z`
        marks.push(<path key={`${j}-${s.i}`} d={d} fill={color(s.i)} />)
      }
    }
  } else if (type === "bar") {
    const k = series.length
    const w = Math.max(2, Math.min(24, (band * 0.8 - (k - 1) * 2) / k))
    const group = k * w + (k - 1) * 2
    series.forEach((s, i) => s.data.forEach((v, j) => {
      if (v === null || v === 0) return
      marks.push(<path key={`${j}-${i}`} d={barPath(cx(j) - group / 2 + i * (w + 2), w, base, y(v))} fill={color(i)} />)
    }))
  } else {
    series.forEach((s, i) => {
      let d = ""
      s.data.forEach((v, j) => { if (v !== null) d += `${d && s.data[j - 1] !== null ? "L" : "M"}${cx(j)},${y(v)}` })
      marks.push(<path key={i} d={d} fill="none" stroke={color(i)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)
      // Isolated points would be invisible as a line.
      s.data.forEach((v, j) => { if (v !== null && (s.data[j - 1] ?? null) === null && (s.data[j + 1] ?? null) === null) marks.push(<circle key={`${i}-${j}`} cx={cx(j)} cy={y(v)} r={4} fill={color(i)} stroke="var(--card)" strokeWidth={2} />) })
    })
  }

  // Direct labels at line ends, nudged apart so they never collide.
  const endLabels = layout.labelled ? (() => {
    const items = series.map((s, i) => {
      const j = s.data.findLastIndex((v) => v !== null)
      return j < 0 ? undefined : { i, name: s.name, y: y(s.data[j]!) }
    }).filter((l) => l !== undefined).sort((a, b) => a.y - b.y)
    for (let k = 1; k < items.length; k++) items[k].y = Math.max(items[k].y, items[k - 1].y + 13)
    return items
  })() : []

  // Beside the hovered band, on the side with more room, so it never covers what it describes.
  const tip = hover === undefined ? undefined : {
    style: cx(hover) < width / 2 ? { left: cx(hover) + band / 2 + 4 } : { right: width - (cx(hover) - band / 2 - 4) },
    rows: series.map((s, i) => ({ i, name: s.name, v: s.data[hover] })),
  }

  return (
    <figure className="viz-root not-prose my-2 rounded-lg border bg-card p-3 text-card-foreground">
      <figcaption className="mb-1 flex items-start gap-2">
        <span className="min-w-0 flex-1 text-sm font-medium">{spec.title}</span>
        <button type="button" onClick={() => setTable((t) => !t)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={table ? "Show chart" : "Show as table"} title={table ? "Show chart" : "Show as table"}>
          {table ? <ChartColumn className="size-4" /> : <Table2 className="size-4" />}
        </button>
      </figcaption>
      {series.length > 1 && (
        <ul className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {series.map((s, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span className={cn("inline-block shrink-0", type === "line" ? "h-0.5 w-3 rounded" : "size-2.5 rounded-sm")} style={{ background: color(i) }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
      {table ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs tabular-nums">
            <thead><tr><th className="border-b px-2 py-1 text-left font-medium" />{series.map((s, i) => <th key={i} className="border-b px-2 py-1 text-right font-medium">{s.name}</th>)}</tr></thead>
            <tbody>{x.map((label, j) => <tr key={j}><td className="border-b px-2 py-1">{label}</td>{series.map((s, i) => <td key={i} className="border-b px-2 py-1 text-right">{s.data[j] === null ? "–" : withUnit(full.format(s.data[j]!), unit)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative" onMouseLeave={() => setHover(undefined)}>
          {width > 0 && (
            <svg width={width} height={HEIGHT} role="img" aria-label={spec.title ?? `${type} chart`} className="block overflow-visible text-[11px]">
              {layout.ticks.map((t, k) => (
                <g key={t}>
                  <line x1={layout.left} x2={layout.left + plotW} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1.5 : 1} />
                  <text x={layout.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fill="var(--muted-foreground)">{layout.tickText[k]}</text>
                </g>
              ))}
              {x.map((label, j) => j % every === 0 && (
                <text key={j} x={cx(j)} y={HEIGHT - 8} textAnchor="middle" fill="var(--muted-foreground)">{label}</text>
              ))}
              {hover !== undefined && (type === "bar"
                ? <rect x={layout.left + band * hover} y={top} width={band} height={plotH} fill="var(--muted-foreground)" opacity={0.08} />
                : <line x1={cx(hover)} x2={cx(hover)} y1={top} y2={top + plotH} stroke="var(--muted-foreground)" strokeDasharray="3 3" />)}
              {marks}
              {type === "line" && hover !== undefined && series.map((s, i) => s.data[hover] !== null && (
                <circle key={i} cx={cx(hover)} cy={y(s.data[hover]!)} r={4.5} fill={color(i)} stroke="var(--card)" strokeWidth={2} />
              ))}
              {endLabels.map((l) => <text key={l.i} x={layout.left + plotW + 6} y={l.y} dy="0.32em" fill="var(--muted-foreground)">{l.name}</text>)}
              {x.map((_, j) => (
                <rect key={j} x={layout.left + band * j} y={0} width={band} height={HEIGHT} fill="transparent" onMouseEnter={() => setHover(j)} onClick={() => setHover(j)} />
              ))}
            </svg>
          )}
          {tip && (
            <div className="pointer-events-none absolute top-0 z-10 min-w-32 rounded-md border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-md" style={tip.style}>
              <div className="mb-0.5 font-medium">{x[hover!]}</div>
              {tip.rows.map((r) => (
                <div key={r.i} className="flex items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-sm" style={{ background: color(r.i) }} />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.name}</span>
                  <span className="tabular-nums">{r.v === null ? "–" : withUnit(full.format(r.v), unit)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  )
}

const previews = new Map<string, Promise<LinkPreview>>()

/** A card for a web page: its title, description and social image, opening the page in a new tab. */
export function LinkPreviewCard({ url }: { url: string }) {
  const [data, setData] = useState<LinkPreview | null>()
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    let alive = true
    let request = previews.get(url)
    if (!request) {
      request = api.linkPreview(url)
      request.catch(() => previews.delete(url))
      previews.set(url, request)
    }
    request.then((d) => alive && setData(d), () => alive && setData(null))
    return () => { alive = false }
  }, [url])
  let host = url
  try { host = new URL(url).hostname.replace(/^www\./, "") } catch { /* keep the raw text */ }
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="not-prose my-2 flex max-h-28 max-w-md overflow-hidden rounded-lg border bg-card text-card-foreground no-underline! hover:bg-accent/50">
      {data?.image && !broken && <img src={data.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="w-28 shrink-0 bg-muted object-cover sm:w-36" />}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 p-2.5">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {data?.icon ? <img src={data.icon} alt="" referrerPolicy="no-referrer" className="size-3.5 rounded-sm" onError={(e) => (e.currentTarget.style.display = "none")} /> : <Globe className="size-3.5" />}
          <span className="truncate">{data?.siteName ?? host}</span>
          <ExternalLink className="ml-auto size-3 shrink-0" />
        </span>
        {data === undefined ? (
          <>
            <span className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <span className="h-3 w-full animate-pulse rounded bg-muted" />
          </>
        ) : (
          <>
            <span className="line-clamp-2 text-sm font-medium">{data?.title ?? url}</span>
            {data?.description && <span className="line-clamp-2 text-xs text-muted-foreground">{data.description}</span>}
          </>
        )}
      </span>
    </a>
  )
}
