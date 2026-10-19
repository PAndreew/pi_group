import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { api, type Interaction } from "@/lib/api"

function InteractionCard({ card, canWrite, onResolved }: { card: Interaction; canWrite: boolean; onResolved: (card: Interaction) => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const pending = card.status === "pending"
  const answer = async (cancelled = false) => {
    setBusy(true)
    try {
      onResolved(await api.answerInteraction(card.sessionKey, card.id, { selected, cancelled }))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const checked = pending ? selected : card.selected ?? []
  return (
    <section className="min-w-0 max-h-[50dvh] overflow-y-auto overscroll-contain rounded-lg border bg-card p-4 text-card-foreground" aria-label={card.spec.title}>
      <h3 className="font-medium break-words">{card.spec.title}</h3>
      {card.spec.description && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{card.spec.description}</p>}
      <fieldset disabled={!pending || !canWrite || busy} className="mt-3 grid gap-2">
        <legend className="sr-only">{card.spec.type === "single_choice" ? "Choose one option" : "Choose one or more options"}</legend>
        {card.spec.options.map((option) => (
          <label key={option.id} className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent">
            <input
              className="mt-0.5 accent-primary"
              type={card.spec.type === "single_choice" ? "radio" : "checkbox"}
              name={card.id}
              checked={checked.includes(option.id)}
              onChange={(event) => setSelected((current) => card.spec.type === "single_choice" ? [option.id] : event.target.checked ? [...current, option.id] : current.filter((id) => id !== option.id))}
            />
            <span className="min-w-0 break-words">{option.label}{option.description && <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span>}</span>
          </label>
        ))}
      </fieldset>
      {pending ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="mr-auto text-xs text-muted-foreground">Awaiting user input</span>
          {canWrite && <><Button variant="ghost" size="sm" disabled={busy} onClick={() => void answer(true)}>Cancel</Button><Button size="sm" disabled={busy || !selected.length} onClick={() => void answer()}>{busy ? "Submitting…" : card.spec.submitLabel ?? "Continue"}</Button></>}
        </div>
      ) : <p className="mt-3 text-xs text-muted-foreground">{card.status === "answered" ? `Answered by ${card.respondent?.username ?? "a participant"}` : card.status === "cancelled" ? `Cancelled by ${card.respondent?.username ?? "a participant"}` : "Expired — the agent is no longer waiting. Ask it to offer these choices again."}</p>}
    </section>
  )
}

/** Persisted cards stay available across reloads, including to other session participants. */
export function useInteractions(sessionKey?: string) {
  const [cards, setCards] = useState<Interaction[]>([])
  useEffect(() => {
    if (!sessionKey) return
    let alive = true
    let loading = false
    const load = async () => {
      if (loading) return
      loading = true
      try {
        const result = await api.interactions(sessionKey)
        if (alive) setCards(result.interactions)
      } catch { /* Keep the last known cards during network interruptions. */ }
      finally { loading = false }
    }
    void load()
    const timer = setInterval(load, 2000)
    const onVisible = () => { if (document.visibilityState === "visible") void load() }
    document.addEventListener("visibilitychange", onVisible)
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible) }
  }, [sessionKey])
  return {
    cards: cards.filter((card) => card.sessionKey === sessionKey),
    onResolved: (updated: Interaction) => setCards((current) => current.map((card) => card.id === updated.id ? updated : card)),
  }
}

export function InteractionCards({ cards, canWrite, onResolved }: { cards: Interaction[]; canWrite: boolean; onResolved: (card: Interaction) => void }) {
  if (!cards.length) return null
  return <div className="mt-2 grid min-w-0 gap-3">{cards.map((card) => <InteractionCard key={card.id} card={card} canWrite={canWrite} onResolved={onResolved} />)}</div>
}
