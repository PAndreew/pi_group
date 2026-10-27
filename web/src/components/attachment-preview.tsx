import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { ImageGallery } from "@/components/image-gallery"
import { imageRefs } from "@/lib/attachments"
import { api } from "@/lib/api"

/** Preview already-uploaded images referenced by a composer draft. */
export function UploadedPreviews({ text }: { text: string }) {
  return <ImageGallery images={imageRefs(text).map((path) => ({ src: api.rawUrl(path), name: path.split("/").pop() }))} />
}

/** Local files are retained until send; object URLs live only as long as the selection. */
export function AttachmentPreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!file.type.startsWith("image/")) return
    const src = URL.createObjectURL(file)
    setUrl(src)
    return () => URL.revokeObjectURL(src)
  }, [file])
  return (
    <div className="relative flex max-w-40 flex-col gap-1 rounded-md border p-1">
      {url && <img src={url} alt={file.name} className="h-24 w-32 rounded object-contain" />}
      <span className="truncate pr-5 text-xs" title={file.name}>{file.name}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${file.name}`} className="absolute right-0 top-0 rounded-full bg-background p-1"><X className="size-4" /></button>
    </div>
  )
}
