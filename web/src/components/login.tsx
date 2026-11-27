import { Loader2 } from "lucide-react"
import { useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { BeezyLogo } from "@/components/beezy-logo"
import { Input } from "@/components/ui/input"

import { useLocale } from "@/lib/i18n"

export function Login() {
  const { t } = useLocale()
  const { login } = useAuth()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await login(username, password)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-[#fdf2a6] p-4 text-neutral-900">
      <BeezyLogo blink className="size-40" />
      <form onSubmit={submit} className="grid w-full max-w-xs gap-3">
        <Input
          id="username"
          aria-label={t("login.username")}
          placeholder={t("login.username")}
          autoComplete="username"
          autoCapitalize="none"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className="h-10 border-black/15 bg-white text-neutral-900 placeholder:text-neutral-500 dark:bg-white"
        />
        <Input
          id="password"
          type="password"
          aria-label={t("login.password")}
          placeholder={t("login.password")}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="h-10 border-black/15 bg-white text-neutral-900 placeholder:text-neutral-500 dark:bg-white"
        />
        {error && <p className="text-sm text-red-700">{error}</p>}
        <Button type="submit" disabled={busy} className="h-10 bg-neutral-900 text-white hover:bg-neutral-800">
          {busy && <Loader2 className="animate-spin" />} {t("login.signIn")}
        </Button>
      </form>
    </div>
  )
}
