import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { FileReferenceLabel } from "@/components/file-reference"
import { VideoThumb } from "@/components/image-gallery"
import { api } from "@/lib/api"
import { fileMediaKind } from "@/lib/attachments"

export function UploadedPreviews({ paths, onRemove }: { paths: string[]; onRemove: (path: string) => void }) {
  if (!paths.length) return null
  return <div className="flex max-h-36 flex-wrap gap-1 overflow-y-auto">
    {paths.map((path) => {
      const name = path.split("/").pop() ?? path
      const media = fileMediaKind(path)
      return <AttachmentTile key={path} name={name} url={media ? api.rawUrl(path) : undefined} video={media === "video"} onRemove={() => onRemove(path)} />
    })}
  </div>
}

/** Local files are retained until send; object URLs live only as long as the selection. */
export function AttachmentPreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string>()
  const media = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : fileMediaKind(file.name)
  useEffect(() => {
    if (!media) return
    const src = URL.createObjectURL(file)
    setUrl(src)
    return () => URL.revokeObjectURL(src)
  }, [file, media])
  return <AttachmentTile name={file.name} url={url} video={media === "video"} onRemove={onRemove} />
}

function AttachmentTile({ name, url, video, onRemove }: { name: string; url?: string; video?: boolean; onRemove: () => void }) {
  return (
    <div className="relative flex max-w-40 flex-col gap-1 rounded-md border p-1">
      {url && (video ? <VideoThumb src={url} name={name} className="h-24 w-32 [&_video]:h-24 [&_video]:w-32" /> : <img src={url} alt={name} className="h-24 w-32 rounded object-contain" />)}
      <span className="truncate pr-6 text-xs underline underline-offset-2" title={name}><FileReferenceLabel name={name} /></span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${name}`} className="absolute right-0 top-0 rounded-full bg-background p-1 hover:bg-accent focus-visible:outline-2"><X className="size-4" /></button>
    </div>
  )
}
