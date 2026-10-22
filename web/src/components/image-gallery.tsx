import { ChevronLeft, ChevronRight, Download, X } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { useState } from "react"
import { cn } from "@/lib/utils"

export interface GalleryImage {
  src: string
  /** Shown as the caption and used for the download name. */
  name?: string
  download?: string
}

/** Thumbnails under a message; tapping one opens it full screen, with arrows between several. */
export function ImageGallery({ images, className }: { images: GalleryImage[]; className?: string }) {
  const [open, setOpen] = useState<number>()
  if (!images.length) return null
  const current = open === undefined ? undefined : images[open]
  const step = (delta: number) => setOpen((i) => (i === undefined ? i : (i + delta + images.length) % images.length))
  return (
    <>
      <div className={cn("mt-2 flex flex-wrap gap-1.5", className)}>
        {images.map((image, i) => (
          <button key={image.src} type="button" onClick={() => setOpen(i)} className="overflow-hidden rounded focus-visible:outline-2" aria-label={`Show ${image.name ?? "image"} full screen`}>
            <img src={image.src} alt={image.name ?? ""} loading="lazy" className="max-h-40 max-w-[16rem] object-cover" />
          </button>
        ))}
      </div>
      <DialogPrimitive.Root open={current !== undefined} onOpenChange={(value) => !value && setOpen(undefined)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/95" />
          <DialogPrimitive.Content
            className="fixed inset-0 z-50 flex flex-col outline-none"
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") step(-1)
              if (e.key === "ArrowRight") step(1)
            }}
          >
            <DialogPrimitive.Title className="sr-only">{current?.name ?? "Image"}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Full screen image</DialogPrimitive.Description>
            <div className="flex shrink-0 items-center gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-white">
              <span className="min-w-0 flex-1 truncate text-sm">{current?.name}</span>
              {images.length > 1 && open !== undefined && <span className="text-xs tabular-nums opacity-70">{open + 1} / {images.length}</span>}
              {current?.download && (
                <a href={current.download} className="grid size-10 place-items-center rounded-full hover:bg-white/15" aria-label="Download image">
                  <Download className="size-5" />
                </a>
              )}
              <DialogPrimitive.Close className="grid size-10 place-items-center rounded-full hover:bg-white/15" aria-label="Close">
                <X className="size-5" />
              </DialogPrimitive.Close>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" onClick={(e) => e.target === e.currentTarget && setOpen(undefined)}>
              {current && <img src={current.src} alt={current.name ?? ""} className="max-h-full max-w-full object-contain" />}
              {images.length > 1 && (
                <>
                  <button type="button" onClick={() => step(-1)} className="absolute left-2 grid size-11 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70" aria-label="Previous image">
                    <ChevronLeft className="size-6" />
                  </button>
                  <button type="button" onClick={() => step(1)} className="absolute right-2 grid size-11 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70" aria-label="Next image">
                    <ChevronRight className="size-6" />
                  </button>
                </>
              )}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}
