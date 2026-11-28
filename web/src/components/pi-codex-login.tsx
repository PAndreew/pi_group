import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"

export function PiCodexLogin() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.piCodexLogin>>>()
  const [busy, setBusy] = useState(false)
  const pending = status?.pending
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const next = await api.piCodexLogin()
        if (active) setStatus(next)
      } catch (error) {
        if (active) toast.error((error as Error).message)
      } finally {
        if (active && pending) timer = setTimeout(refresh, 2000)
      }
    }
    void refresh()
    return () => { active = false; clearTimeout(timer) }
  }, [pending])
  async function perform(action: () => Promise<unknown>) {
    setBusy(true)
    try { await action(); setStatus(await api.piCodexLogin()) }
    catch (error) { toast.error((error as Error).message) }
    finally { setBusy(false) }
  }
  if (!status) return <p className="text-sm text-muted-foreground">Checking Codex sign-in…</p>
  return <section className="grid gap-2">
    <h4 className="font-medium">ChatGPT subscription (Codex)</h4>
    {status.pending ? <>
      {status.code ? <>
        <p className="text-sm">Open <a className="underline" href="https://auth.openai.com/codex/device" target="_blank" rel="noopener noreferrer">OpenAI’s device sign-in ↗</a> and enter this code:</p>
        <code className="w-fit select-all rounded bg-muted px-3 py-2 text-lg">{status.code}</code>
        <p className="text-sm text-muted-foreground">Beezy connects automatically once you approve. If OpenAI asks, enable device code authorization in your ChatGPT security settings.</p>
      </> : <p className="text-sm text-muted-foreground">Requesting a device code…</p>}
      <Button variant="outline" disabled={busy} onClick={() => void perform(api.cancelPiCodexLogin)}>Cancel sign-in</Button>
    </> : <>
      {status.failed && <p className="text-sm text-destructive" role="alert">Codex sign-in did not complete. Try again and check that your ChatGPT account allows device code authorization.</p>}
      <p className="text-sm text-muted-foreground">{status.connected ? "Connected. Choose a Codex model in Model settings." : "Use your ChatGPT subscription instead of an OpenAI API key."}</p>
      {status.manageable && <Button disabled={busy} onClick={() => void perform(api.startPiCodexLogin)}>{status.connected ? "Reconnect ChatGPT" : "Sign in with ChatGPT"}</Button>}
    </>}
  </section>
}
