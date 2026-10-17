import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ChatList } from "@/components/chat-list"
import { ComposerTools } from "@/components/composer-tools"
import { MentionComposer, parseMessage } from "@/components/mention-composer"
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { useNav } from "@/lib/nav"

/**
 * Home: earlier chats, and a message box that starts a new one. Mention @pi, one or more people,
 * or both; add #folder to pick where pi works (the shared chat folder otherwise).
 */
export function Home() {
  const { user } = useAuth()
  const nav = useNav()
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [chatFolder, setChatFolder] = useState("pi-chat")

  useEffect(() => {
    api.searchFolders("").then((r) => setChatFolder(r.chatFolder), () => {})
  }, [])

  // The icons act on the #folder being typed, or the chat folder.
  const folder = parseMessage(text, []).folder ?? chatFolder

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col">
      <ChatList className="min-h-0 flex-1" />
      <div className="grid gap-1 border-t p-2 sm:p-3">
        <MentionComposer
          value={text}
          onChange={setText}
          busy={busy}
          selfId={user?.id}
          placeholder="Start a chat: @pi, @someone, #folder…"
          onSubmit={async (message) => {
            if (!message.pi && message.people.length === 0) return void toast.info("Mention @pi or at least one person to start a chat.")
            if (!message.text) return void toast.info("Write a message too.")
            setBusy(true)
            try {
              const started = await api.startChat({ text: message.text, pi: message.pi, userIds: message.people.map((p) => p.id), folder: message.folder })
              setText("")
              if (started.chat) nav.openChat(started.chat)
              else if (started.session) nav.openSession(started.session, message.folder ?? chatFolder)
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
