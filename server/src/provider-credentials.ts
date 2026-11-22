import { createHash } from "node:crypto";
import type { Secrets } from "./ports/index.js";

export type ProviderAccount = { tenantId: string; userId: string };
export type ProviderModel = { provider: string; id: string };
export type ModelBilling = "personal" | "shared";
export type RunModel = { model: ProviderModel; billing: ModelBilling };

// Deliberately disjoint from both tenant.user and tenant.project.id. Neither
// the general vault endpoints nor the agent vault tools address this namespace.
const namespace = ({ tenantId, userId }: ProviderAccount) => `${tenantId}.model-credentials.${userId}`;

// Vault keys permit only letters, digits and underscores; provider IDs may contain hyphens.
const keyOf = (provider: string) => `p_${createHash("sha256").update(provider).digest("hex").slice(0, 62)}`;

export function providerCredentials(vault: Secrets) {
	return {
		async list(account: ProviderAccount) {
			return (await vault.list(namespace(account))).map(({ description, updatedAt }) => ({ provider: description, updatedAt }));
		},
		async save(account: ProviderAccount, provider: string, apiKey: string) {
			await vault.put(namespace(account), keyOf(provider), { value: apiKey, description: provider });
		},
		remove(account: ProviderAccount, provider: string) {
			return vault.delete(namespace(account), keyOf(provider));
		},
		// Call only inside a trusted provider transport, immediately before sending.
		async readForRequest(account: ProviderAccount, provider: string) {
			return (await vault.get(namespace(account), keyOf(provider))).value;
		},
	};
}

/** Resolve before starting a turn, without decrypting anything. A vault outage
 * or provider rejection is not a reason to silently change the payer. */
export async function selectRunModel(
	preferred: ProviderModel,
	fallback: RunModel | undefined,
	hasPersonalKey: (provider: string) => Promise<boolean>,
): Promise<RunModel> {
	if (await hasPersonalKey(preferred.provider)) return { model: preferred, billing: "personal" };
	if (fallback?.billing === "shared") return fallback;
	if (fallback && fallback.model.provider !== preferred.provider && await hasPersonalKey(fallback.model.provider)) return fallback;
	throw new Error("No personal credential configured for the preferred or fallback provider.");
}
