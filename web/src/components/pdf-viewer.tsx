import "core-js/actual/promise/with-resolvers"
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import { Button } from "@/components/ui/button"

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString()

/** pdf.js renders PDFs on phones too, where an <iframe> would only offer a download. */
export default function PdfViewer({ url }: { url: string }) {
  const [pages, setPages] = useState(0)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)
  const [pageRatio, setPageRatio] = useState(1)
  // Retina canvases grow quadratically with zoom. Keep them within a modest
  // backing-store budget, especially in iOS standalone WebKit.
  const renderWidth = width * zoom
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / Math.max(1, renderWidth * renderWidth * pageRatio)))
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width - 16)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex items-center justify-center gap-1 border-b p-1.5">
        <Button variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          <ChevronLeft />
        </Button>
        <span className="min-w-20 text-center text-xs tabular-nums">
          {page} / {pages || "…"}
        </span>
        <Button variant="ghost" size="icon-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          <ChevronRight />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
          <ZoomOut />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
          <ZoomIn />
        </Button>
      </div>
      <div ref={box} className="min-h-0 min-w-0 flex-1 overflow-auto bg-muted/40 p-2">
        {width > 0 && <Document
          suspense={false}
          file={url}
          onLoadSuccess={(doc) => setPages(doc.numPages)}
          loading={<Loader2 className="mx-auto mt-10 animate-spin" />}
          error={<p className="p-4 text-sm text-destructive">Could not load the PDF.</p>}
        >
          <Page
            suspense={false}
            pageNumber={page}
            width={renderWidth}
            devicePixelRatio={pixelRatio}
            onLoadSuccess={(loaded) => {
              const viewport = loaded.getViewport({ scale: 1 })
              setPageRatio(viewport.height / viewport.width)
            }}
            error={<p className="p-4 text-sm text-destructive">Could not render this page. Use Download to open it separately.</p>}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            className="mx-auto w-fit shadow"
          />
        </Document>}
      </div>
    </div>
  )
}
