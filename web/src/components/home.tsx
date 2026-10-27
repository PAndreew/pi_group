import { Folder } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { UploadedPreviews } from "@/components/attachment-preview"
import { ChatList } from "@/components/chat-list"
import { AgentToggle, ComposerControls, type ComposerConfig } from "@/components/composer-controls"
import { ComposerTools } from "@/components/composer-tools"
import { MentionComposer, parseMessage, withFolder } from "@/components/mention-composer"
import { useAuth } from "@/hooks/use-auth"
import { useOverlayOpen } from "@/hooks/use-overlay-open"
import { uploadDir } from "@/lib/attachments"
import { api } from "@/lib/api"
import { useNav } from "@/lib/nav"
import { useProjects } from "@/lib/projects"

/**
 * Home: the active project's chats, and a message box that starts a new one in it. Mention @pi, one
 * or more people, or both; add #folder to pick where pi works (the project's folder otherwise; for
 * General, the shared chat folder).
 */
export function Home() {
  const { user } = useAuth()
  const nav = useNav()
  const { active: project } = useProjects()
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const attach = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    try {
      const { files: uploaded } = await api.upload(uploadDir(project && !project.general ? project.folder : folder), files)
      setText((current) => `${current}${current ? " " : ""}${uploaded.map((file) => `\`${file.path}\``).join(" ")} `)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const [agent, setAgent] = useState(false)
  const [composerConfig, setComposerConfig] = useState<ComposerConfig>({})
  const [chatFolder, setChatFolder] = useState("pi-chat")

  const [recent, setRecent] = useState<string[]>([])
  const overlay = useOverlayOpen()

  useEffect(() => {
    api.searchFolders("").then((r) => setChatFolder(r.chatFolder), () => {})
  }, [])

  const base = project && !project.general ? project.folder : chatFolder

  // The project's linked folders, then the last folders its chats or sessions worked in (not its own), to start there.
  useEffect(() => {
    if (!project) return
    api.chats(project.id).then(({ chats }) => {
      const used = chats.filter((c) => c.folder && c.folder !== base && (c.kind === "session" || c.pi)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      setRecent([...new Set([...project.links, ...used.map((c) => c.folder)])].slice(0, 4))
    }, () => {})
  }, [base, project])

  // The icons act on the #folder being typed, or the project's folder.
  const folder = parseMessage(text, []).folder ?? base

  return (
    <div className="mx-auto flex h-full min-w-0 w-full max-w-2xl flex-col">
      <ChatList key={project?.id} className="min-h-0 flex-1" requests />
      <div className="grid gap-1 border-t p-2 sm:p-3">
        {recent.length > 0 && !overlay && (
          <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-1" aria-label="Recent folders">
            {recent.map((f) => (
              <button
                key={f}
                type="button"
                title={`Start in /${f}`}
                data-active={folder === f}
                onClick={() => {
                  setText((t) => withFolder(t, f))
                  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("[data-composer-box] textarea")?.focus())
                }}
                className="flex min-w-0 max-w-[40%] shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground data-[active=true]:border-primary data-[active=true]:text-foreground"
              >
                <Folder className="size-3.5 shrink-0" />
                <span className="truncate">{f.split("/").pop()}</span>
              </button>
            ))}
          </div>
        )}
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void attach(files) }} />
        <UploadedPreviews text={text} />
        <MentionComposer
          folder={folder}
          value={text}
          onChange={setText}
          busy={busy}
          selfId={user?.id}
          placeholder={project && !project.general ? `Start a chat in ${project.name}: message, @someone, #folder…` : "Start a chat: message, @someone, #folder…"}
          agent={<AgentToggle checked={agent} onChange={setAgent} disabled={busy} />}
          controls={
            <ComposerControls draft={composerConfig} onDraftChange={setComposerConfig} disabled={busy} agentEnabled={agent} onCamera={(files) => void attach(files)} onAttach={() => fileInput.current?.click()} />
          }
          onFiles={(files) => void attach(files)}
          onSubmit={async (message) => {
            message.pi ||= agent
            if (!message.pi && message.people.length === 0) return void toast.info("Mention @pi or at least one person to start a chat.")
            if (!message.text) return void toast.info("Write a message too.")
            setBusy(true)
            try {
              const started = await api.startChat({ text: message.text, pi: message.pi, userIds: message.people.map((p) => p.id), folder: message.folder ?? (base !== chatFolder ? base : undefined), projectId: project?.id, ...(message.pi ? composerConfig : {}) })
              setText("")
              if (started.chat) nav.openChat(started.chat)
              else if (started.session) nav.openSession(started.session, message.folder ?? base)
            } catch (error) {
              toast.error((error as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        />
        <ComposerTools folder={folder} onInsert={(command) => setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}${command}`)} />
      </div>
    </div>
  )
}
