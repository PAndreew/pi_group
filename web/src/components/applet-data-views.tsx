import { useLocale } from "@/lib/i18n"
import { useEffect, useState } from "react"
import { Chart } from "@/components/rich-blocks"
import { Button } from "@/components/ui/button"
import { api, type AppletDataPage, type AppletDataValue, type AppletDataView } from "@/lib/api"

const show = (v: AppletDataValue | undefined) => v == null ? "—" : String(v)

function DataView({ applet, view, first }: { applet: string; view: AppletDataView; first: AppletDataPage }) {
  const { t: tr } = useLocale()
  const [pages, setPages] = useState<{ offset: number; data: AppletDataPage }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const current = pages.at(-1)?.data ?? first
  const rows = current.rows
  const next = async () => {
    if (current.nextOffset == null) return
    const offset = current.nextOffset
    setBusy(true)
    setError(undefined)
    try {
      const { views } = await api.appletDataViews(applet, view.id, offset)
      setPages((all) => [...all, { offset, data: views[view.id] }])
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const points = view.type === "chart" ? rows.filter((r) => r[view.x] != null && typeof r[view.y] === "number") : []
  return (
    <section className="grid min-w-0 gap-2 rounded-lg border bg-card p-4">
      <h3 className="text-sm font-medium">{view.title}</h3>
      {view.type === "table" && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-label={view.title}>
            <thead><tr>{view.columns.map((c) => <th key={c.key} scope="col" className="min-w-12 border-b px-2 py-1.5 font-medium">{c.label}</th>)}</tr></thead>
            <tbody>{rows.map((row, i) => <tr key={i} className="border-b last:border-0">{view.columns.map((c) => <td key={c.key} className="max-w-72 px-2 py-1.5 align-top whitespace-pre-wrap wrap-anywhere">{show(row[c.key])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : view.type === "chart" && points.length ? (
        <Chart spec={{ type: view.chart, x: points.map((r) => show(r[view.x]).slice(0, 80)), series: [{ name: view.label, data: points.map((r) => Number(r[view.y])) }], unit: view.unit }} />
      ) : <p className="text-xs text-muted-foreground">{tr("ui.no-data-to-display-yet-0f6e97")}</p>}
      {(pages.length > 0 || current.nextOffset != null) && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy || !pages.length} onClick={() => { setPages((all) => all.slice(0, -1)); setError(undefined) }}>{tr("ui.previous-50f942")}</Button>
          <span className="text-xs text-muted-foreground">{tr("ui.page-fb0627")} {pages.length + 1}</span>
          <Button type="button" variant="outline" size="sm" disabled={busy || current.nextOffset == null} onClick={() => void next()}>{tr("ui.next-bc9819")}</Button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  )
}

export function AppletDataViews({ applet, views, revision }: { applet: string; views: AppletDataView[]; revision: number }) {
  const { t: tr } = useLocale()
  const [state, setState] = useState<{ views: Record<string, AppletDataPage>; revision: number }>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let current = true
    api.appletDataViews(applet).then((result) => {
      if (!current) return
      setState({ ...result, revision })
      setError(undefined)
    }, (error: Error) => { if (current) setError(error.message) })
    return () => { current = false }
  }, [applet, revision])
  return (
    <div className="grid min-w-0 gap-3">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!state && !error && <p role="status" className="text-sm text-muted-foreground">{tr("ui.loading-saved-data-3a2942")}</p>}
      {state && views.map((view) => state.views[view.id] && <DataView key={`${view.id}-${state.revision}`} applet={applet} view={view} first={state.views[view.id]} />)}
    </div>
  )
}
