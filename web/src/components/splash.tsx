import { useLocale } from "@/lib/i18n"
import { useEffect, useState } from "react"
import { RotateCw } from "lucide-react"
import { BeezyLogo } from "@/components/beezy-logo"
import { Button } from "@/components/ui/button"
import type { Connection } from "@/hooks/use-auth"

/** Shown while the app first reaches the server: a blinking bee and what is going on. */
export function Splash({ connection, onRetry }: { connection: Connection; onRetry: () => void }) {
  const { t: tr } = useLocale()
  const [now, setNow] = useState(Date.now)
  const [since] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [])
  const slow = connection.state === "connecting" && now - since > 5000
  const offline = connection.state === "offline"
  const seconds = offline ? Math.max(0, Math.ceil((connection.retryAt - now) / 1000)) : 0

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-5 bg-background px-6 text-center" role="status" aria-live="polite">
      <BeezyLogo blink className="size-24 drop-shadow-[0_0_24px_rgba(255,255,0,0.18)]" />
      <div className="grid max-w-xs gap-1.5">
        <p className="text-base font-medium">{offline ? "Can't reach beezy right now" : slow ? "Still buzzing over…" : "Waking up the hive…"}</p>
        <p className="text-sm text-muted-foreground">
          {offline
            ? `${connection.reason} The server may be restarting, or you are offline. ${seconds > 0 ? `Trying again in ${seconds} s.` : "Trying again…"}`
            : slow
              ? "This is taking longer than usual. The server may be restarting or your connection is slow."
              : "Connecting to the server."}
        </p>
      </div>
      {(offline || slow) && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw /> {tr("ui.try-now-ae09ba")}
        </Button>
      )}
    </div>
  )
}
