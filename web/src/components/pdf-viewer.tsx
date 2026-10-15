import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import { Button } from "@/components/ui/button"

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()

/** pdf.js renders PDFs on phones too, where an <iframe> would only offer a download. */
export default function PdfViewer({ url }: { url: string }) {
  const [pages, setPages] = useState(0)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(600)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width - 16)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="flex h-full flex-col">
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
      <div ref={box} className="flex-1 overflow-auto bg-muted/40 p-2">
        <Document
          file={url}
          onLoadSuccess={(doc) => setPages(doc.numPages)}
          loading={<Loader2 className="mx-auto mt-10 animate-spin" />}
          error={<p className="p-4 text-sm text-destructive">Could not load the PDF.</p>}
        >
          <Page pageNumber={page} width={width * zoom} renderTextLayer={false} renderAnnotationLayer={false} className="mx-auto w-fit shadow" />
        </Document>
      </div>
    </div>
  )
}
