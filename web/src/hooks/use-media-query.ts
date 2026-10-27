import { useSyncExternalStore } from "react"

/** Whether a CSS media query matches, following changes (e.g. "(min-width: 1280px)"). */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query)
      media.addEventListener("change", onChange)
      return () => media.removeEventListener("change", onChange)
    },
    () => window.matchMedia(query).matches,
  )
}
