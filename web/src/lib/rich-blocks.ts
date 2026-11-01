/* Generative UI: fenced ```chart and ```preview blocks in agent replies render as live widgets. */

export interface ChartSpec {
  type: "bar" | "line"
  title?: string
  x: string[]
  series: { name: string; data: (number | null)[] }[]
  unit?: string
  stacked?: boolean
}

const MAX_SERIES = 8

/** A chart block's JSON as a spec, or an error message. Accepts `labels` for `x` and `data: [{label, value}]` for one series. */
export function parseChart(source: string): ChartSpec | string {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(source) } catch { return "The chart data is not valid JSON." }
  if (!raw || typeof raw !== "object") return "The chart data must be an object."
  const type = raw.type === "line" ? "line" : raw.type === "bar" || raw.type === undefined ? "bar" : undefined
  if (!type) return `Unknown chart type "${String(raw.type)}" (use "bar" or "line").`
  let x = Array.isArray(raw.x) ? raw.x : Array.isArray(raw.labels) ? raw.labels : undefined
  let series = Array.isArray(raw.series) ? raw.series : undefined
  if (!series && Array.isArray(raw.data)) {
    const rows = raw.data as { label?: unknown; value?: unknown }[]
    x = rows.map((row) => row?.label)
    series = [{ name: typeof raw.title === "string" ? raw.title : "Value", data: rows.map((row) => row?.value) }]
  }
  if (!x?.length || !series?.length) return "A chart needs `x` labels and at least one series."
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null)
  const clean = series.slice(0, MAX_SERIES).map((s, i) => {
    const item = (s ?? {}) as { name?: unknown; data?: unknown }
    const data = Array.isArray(item.data) ? item.data : []
    return { name: typeof item.name === "string" && item.name ? item.name : `Series ${i + 1}`, data: x!.map((_, j) => num(data[j])) }
  })
  return {
    type,
    title: typeof raw.title === "string" ? raw.title : undefined,
    x: x.map((label) => String(label ?? "")),
    series: clean,
    unit: typeof raw.unit === "string" ? raw.unit : undefined,
    stacked: raw.stacked === true && clean.length > 1,
  }
}

/** The http(s) URLs of a ```preview block, one per line. */
export const previewUrls = (source: string) => source.split(/\s+/).filter((line) => /^https?:\/\/\S+$/i.test(line)).slice(0, 6)
