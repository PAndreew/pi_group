import { useEffect, useState } from "react"
import { toast } from "sonner"
import { PiCodexLogin } from "@/components/pi-codex-login"
import { PiProfileSettings } from "@/components/pi-profile-settings"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"

export function HarnessLoginDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.claudeLogin>>>()
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const pending = status?.pending
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const refresh = () => void api.claudeLogin().then(next => { if (!cancelled) setStatus(next) }).catch(() => {})
    refresh()
    const timer = pending ? window.setInterval(refresh, 1600) : undefined
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [open, pending])
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true)
    try { await fn(); setStatus(await api.claudeLogin()) }
    catch (error) { toast.error((error as Error).message) }
    finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={next => { if (!next) setCode(""); onOpenChange(next) }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Harness login</DialogTitle>
        <DialogDescription>Connect your own provider accounts for each harness.</DialogDescription>
      </DialogHeader>
      <section className="grid gap-3">
        <h3 className="flex items-center gap-2 font-medium"><img src={`${import.meta.env.BASE_URL}pi-logo.svg`} alt="" className="size-6 object-contain" />Pi Coding Agent</h3>
        {open && <><PiCodexLogin /><PiProfileSettings loginOnly /></>}
      </section>
      <section className="grid gap-2 border-t pt-3">
        <h3 className="flex items-center gap-2 font-medium"><img src={`${import.meta.env.BASE_URL}claude-logo.svg`} alt="" className="size-6 object-contain" />Claude Code</h3>
        {!status ? <p className="text-sm text-muted-foreground">Checking Claude Code…</p> : !status.supported ? <p className="text-sm text-muted-foreground">Claude Code is not configured on this server.</p> : pending ? <>
          {status.url ? <>
            <a href={status.url} target="_blank" rel="noopener noreferrer" className="text-sm underline">Open Claude sign-in ↗</a>
            <form className="grid gap-2" onSubmit={e => { e.preventDefault(); void perform(async () => { await api.finishClaudeLogin(code.trim()); setSubmitted(true); setCode("") }) }}>
              <label htmlFor="claude-login-code" className="text-sm">Paste the one-time code shown by Claude</label>
              <Input id="claude-login-code" value={code} onChange={e => setCode(e.target.value)} type="password" autoComplete="off" maxLength={2048} disabled={submitted} />
              <Button disabled={busy || submitted || !code.trim()}>{submitted ? "Checking code…" : "Finish sign-in"}</Button>
            </form>
          </> : <p className="text-sm text-muted-foreground">Waiting for the sign-in link…</p>}
          <Button variant="outline" disabled={busy} onClick={() => void perform(api.cancelClaudeLogin)}>Cancel sign-in</Button>
        </> : <>
          <p className="text-sm text-muted-foreground">{status.connected ? "Your Claude subscription is connected." : submitted ? "Sign-in did not complete. Try again with a Pro or Max subscription." : "Sign in with your own Claude Pro or Max subscription."}</p>
          <Button disabled={busy} onClick={() => { setSubmitted(false); void perform(api.startClaudeLogin) }}>{status.connected ? "Reconnect Claude Code" : "Sign in to Claude Code"}</Button>
        </>}
      </section>
    </DialogContent>
  </Dialog>
}
