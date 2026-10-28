import { ChevronLeft, ChevronRight, Download, Play, X } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { useState } from "react"
import { cn } from "@/lib/utils"

export interface GalleryImage {
  src: string
  /** Shown as the caption and used for the download name. */
  name?: string
  download?: string
  /** A video: its first frame with a play button, playing in place. */
  video?: boolean
}

/** A video's first frame with a play button; pressing it plays the video right there, with controls. */
export function VideoThumb({ src, name, className }: { src: string; name?: string; className?: string }) {
  const [playing, setPlaying] = useState(false)
  if (playing) return <video src={src} controls autoPlay playsInline className={cn("max-h-64 max-w-[20rem] rounded bg-black", className)} />
  return (
    <button type="button" onClick={() => setPlaying(true)} className={cn("relative overflow-hidden rounded bg-black focus-visible:outline-2", className)} aria-label={`Play ${name ?? "video"}`}>
      {/* #t asks for the first frame, so the thumbnail is not black. */}
      <video src={`${src}#t=0.1`} preload="metadata" muted playsInline className="pointer-events-none max-h-40 max-w-[16rem] object-cover" />
      <span className="absolute inset-0 grid place-items-center">
        <span className="grid size-11 place-items-center rounded-full bg-black/60 text-white shadow">
          <Play className="ml-0.5 size-5 fill-current" />
        </span>
      </span>
    </button>
  )
}

/** Thumbnails under a message; tapping an image opens it full screen, with arrows between several. Videos play in place. */
export function ImageGallery({ images: media, className }: { images: GalleryImage[]; className?: string }) {
  const [open, setOpen] = useState<number>()
  if (!media.length) return null
  const images = media.filter((m) => !m.video)
  const current = open === undefined ? undefined : images[open]
  const step = (delta: number) => setOpen((i) => (i === undefined ? i : (i + delta + images.length) % images.length))
  return (
    <>
      <div className={cn("mt-2 flex flex-wrap gap-1.5", className)}>
        {media.map((item) =>
          item.video ? (
            <VideoThumb key={item.src} src={item.src} name={item.name} />
          ) : (
            <button key={item.src} type="button" onClick={() => setOpen(images.indexOf(item))} className="overflow-hidden rounded focus-visible:outline-2" aria-label={`Show ${item.name ?? "image"} full screen`}>
              <img src={item.src} alt={item.name ?? ""} loading="lazy" className="max-h-40 max-w-[16rem] object-cover" />
            </button>
          ),
        )}
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
