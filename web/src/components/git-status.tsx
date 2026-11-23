import { useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Check, CircleDot, GitBranch } from "lucide-react"
import { api, type GitStatus } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * The session folder's git state, refreshed when it is likely to have changed: on open, while the
 * agent works (debounced on new messages), when a run ends, on return to the tab and every 30 s.
 */
function useGitStatus(sessionKey: string, running: boolean, activity: number) {
  const [git, setGit] = useState<GitStatus | null>()
  const inFlight = useRef(false)
  const refresh = useRef(() => {})
  refresh.current = () => {
    if (inFlight.current || document.visibilityState !== "visible") return
    inFlight.current = true
    api.git(sessionKey).then(({ git }) => setGit(git), () => {}).finally(() => (inFlight.current = false))
  }

  useEffect(() => {
    setGit(undefined)
    refresh.current()
    const timer = setInterval(() => refresh.current(), 30_000)
    const onVisible = () => refresh.current()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [sessionKey])

  useEffect(() => {
    const timer = setTimeout(() => refresh.current(), running ? 2000 : 500)
    return () => clearTimeout(timer)
  }, [running, activity])

  return git
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** Git icon · changed files · clean/dirty/behind · branch, for the line under the session title. */
export function GitStatusIndicator({ sessionKey, running, activity }: { sessionKey: string; running: boolean; activity: number }) {
  const git = useGitStatus(sessionKey, running, activity)
  if (!git) return null

  const dirty = git.files > 0
  const tip = [
    `${git.detached ? "Detached at" : "Branch"} ${git.branch}`,
    dirty ? `${plural(git.files, "changed file")}` : "No local changes",
    git.upstream
      ? [git.behind ? `${plural(git.behind, "commit")} behind ${git.upstream}` : `Up to date with ${git.upstream}`, git.ahead ? `${plural(git.ahead, "commit")} ahead` : ""].filter(Boolean).join(", ")
      : "No remote tracking branch",
    git.fetchFailed ? "Could not fetch the remote; behind count may be out of date" : git.fetchedAt ? `Remote checked ${new Date(git.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "",
  ].filter(Boolean).join("\n")

  return (
    <span className="flex min-w-0 items-center gap-1" title={tip} aria-label={tip.replaceAll("\n", ". ")}>
      <span aria-hidden>·</span>
      <GitBranch className="size-3 shrink-0" />
      <span className={cn("tabular-nums", dirty && "text-amber-600 dark:text-amber-400")}>{git.files}</span>
      {git.behind > 0 ? (
        <span className={cn("flex items-center text-sky-600 dark:text-sky-400", git.fetchFailed && "opacity-60")}>
          <ArrowDown className="size-3" />
          <span className="tabular-nums">{git.behind}</span>
        </span>
      ) : dirty ? (
        <CircleDot className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
      ) : (
        <Check className="size-3 shrink-0 text-green-600 dark:text-green-500" />
      )}
      {git.ahead > 0 && (
        <span className="flex items-center">
          <ArrowUp className="size-3" />
          <span className="tabular-nums">{git.ahead}</span>
        </span>
      )}
      <span className="min-w-0 truncate">{git.branch}</span>
    </span>
  )
}
