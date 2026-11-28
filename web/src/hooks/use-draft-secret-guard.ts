import { useLayoutEffect, useRef, useState } from "react"
import { findDraftSecrets, referenceDraftSecret, type DraftSecret } from "@/lib/draft-secrets"

/** Intercepts submit before any prompt request. Saving changes the draft, never submits it. */
export function useDraftSecretGuard(value: string, onChange: (value: string) => void) {
  const [candidate, setCandidate] = useState<DraftSecret>()
  const current = useRef({ value, onChange })
  useLayoutEffect(() => { current.current = { value, onChange } }, [value, onChange])

  return {
    candidate,
    blockSubmit() {
      if (candidate) return true
      const [match] = findDraftSecrets(value)
      if (!match) return false
      setCandidate(match)
      return true
    },
    close() { setCandidate(undefined) },
    saved(key: string) {
      if (candidate && current.current.value.includes(candidate.value)) {
        current.current.onChange(referenceDraftSecret(current.current.value, candidate.value, key))
      }
      setCandidate(undefined)
    },
  }
}
