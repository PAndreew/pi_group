import { useState } from "react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { AuthorAvatar } from "@/components/author-avatar"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

export function ProfilePictureDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const save = async (file: File | null) => {
    setBusy(true)
    try {
      let avatar: string | null = null
      if (file) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Choose a PNG, JPEG or WebP image under 10 MB")
        const bitmap = await createImageBitmap(file)
        try {
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 256
          const context = canvas.getContext('2d')!
          const side = Math.min(bitmap.width, bitmap.height)
          context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256)
          avatar = canvas.toDataURL('image/png')
        } finally { bitmap.close() }
      }
      await api.saveAvatar(avatar)
      window.dispatchEvent(new Event('beezy:avatar'))
      toast.success(file ? 'Profile picture updated' : 'Profile picture removed')
    } catch (error) { toast.error((error as Error).message) }
    finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="grid-cols-[minmax(0,1fr)]">
      <DialogHeader><DialogTitle>Profile picture</DialogTitle><DialogDescription>Choose a photo for your avatar. Images are cropped to a square.</DialogDescription></DialogHeader>
      {user && <AuthorAvatar id={user.id} name={user.username} />}
      <input aria-label="Upload profile picture" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} className="min-w-0 max-w-full text-sm" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void save(file) }} />
      <Button variant="outline" disabled={busy} onClick={() => void save(null)}>Remove picture</Button>
    </DialogContent>
  </Dialog>
}
