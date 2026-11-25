import { useLocale } from "@/lib/i18n"

/** Inherits the message bubble’s theme color, including white in dark mode. */
export function BusyBee() {
  const { t } = useLocale()
  return (
    <div role="status" aria-label={t("message.working")}>
      <pre aria-hidden="true" className="ascii-bee m-0 font-mono text-xs leading-tight">
        <span className="ascii-bee-wing-left" />{"(oo)"}<span className="ascii-bee-wing-right" />
      </pre>
    </div>
  )
}
