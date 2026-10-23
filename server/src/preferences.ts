import { z } from "zod";

export const assistanceSettingsSchema = z.object({
	injectionChecks: z.boolean().default(false),
	contextExtraction: z.boolean().default(false),
	toolSelection: z.boolean().default(false),
	dailyBudgetUsd: z.number().min(0).max(10).default(1),
	maxCallsPerRun: z.number().int().min(1).max(100).default(40),
}).strict();
export type AssistanceSettings = z.infer<typeof assistanceSettingsSchema>;
export const assistanceDefaults = assistanceSettingsSchema.parse({});

export const sessionDefaultsSchema = z.object({
	harness: z.string().min(1).max(80),
	model: z.object({ provider: z.string().min(1).max(120), id: z.string().min(1).max(200) }),
	thinkingLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
});
export type SessionDefaults = z.infer<typeof sessionDefaultsSchema>;

/** Explicit request values win; never apply another harness's defaults. */
export function creationOptions(input: { harness: string; model?: SessionDefaults["model"]; thinkingLevel?: string }, defaults?: SessionDefaults) {
	const matching = defaults?.harness === input.harness ? defaults : undefined;
	return { model: input.model ?? matching?.model, thinkingLevel: input.thinkingLevel ?? matching?.thinkingLevel };
}
