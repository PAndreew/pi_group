import { useMemo } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { type ModelInfo, THINKING_LEVELS } from "@/lib/api"
import { cn } from "@/lib/utils"

/** Provider picker (only when more than one provider is configured) plus model picker. */
export function ModelPicker({
  models,
  value,
  onChange,
  disabled,
  compact,
}: {
  models: ModelInfo[]
  value?: { provider: string; id: string }
  onChange: (model: { provider: string; id: string }) => void
  disabled?: boolean
  compact?: boolean
}) {
  const providers = useMemo(() => [...new Set(models.map((m) => m.provider))].sort(), [models])
  const provider = value?.provider && providers.includes(value.provider) ? value.provider : providers[0]
  const inProvider = models.filter((m) => m.provider === provider)
  const current = models.find((m) => m.provider === value?.provider && m.id === value?.id)
  const size = compact ? "sm" : "default"

  if (models.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {value ? `${value.provider}/${value.id}` : "No models available. Configure a provider in pi (pi auth / API key env vars)."}
      </span>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {providers.length > 1 && (
        <Select
          value={provider}
          disabled={disabled}
          onValueChange={(p) => {
            const first = models.find((m) => m.provider === p)
            if (first) onChange({ provider: p, id: first.id })
          }}
        >
          <SelectTrigger size={size} className={cn("max-w-36", compact && "text-xs")} aria-label="Provider">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select value={current ? current.id : undefined} disabled={disabled} onValueChange={(id) => onChange({ provider: provider!, id })}>
        <SelectTrigger size={size} className={cn("max-w-56 min-w-0", compact && "text-xs")} aria-label="Model">
          <SelectValue placeholder={value ? value.id : "Model"} />
        </SelectTrigger>
        <SelectContent>
          {inProvider.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function ThinkingPicker({ value, onChange, disabled, compact }: { value?: string; onChange: (v: string) => void; disabled?: boolean; compact?: boolean }) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger size={compact ? "sm" : "default"} className={cn("w-auto", compact && "text-xs")} aria-label="Thinking level">
        <SelectValue placeholder="thinking" />
      </SelectTrigger>
      <SelectContent>
        {THINKING_LEVELS.map((l) => (
          <SelectItem key={l} value={l}>
            think: {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
