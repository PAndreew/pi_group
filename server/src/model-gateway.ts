import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { HttpError } from "./files.js";

export const gatewayProviders = ["openai", "anthropic", "gemini", "openrouter", "zhipu"] as const;
export type GatewayProvider = typeof gatewayProviders[number];
export type GatewayModel = { provider: GatewayProvider; model: string };
export type GatewayRun = GatewayModel & { token: string; runId: string };
export const gatewayUrl = () => process.env.BEEZY_GATEWAY_URL?.replace(/\/+$/, "");
export const gatewayEnabled = () => Boolean(gatewayUrl() && process.env.BEEZY_GATEWAY_TOKEN_FILE);
const account = (tenant: string, user: string) => createHash("sha256").update(JSON.stringify([tenant, user])).digest("hex");
const credential = (tenant: string, user: string, provider: GatewayProvider) => `/admin/credentials/${account(tenant, user)}/${provider}`;

async function request<T>(path: string, method = "GET", body?: object): Promise<T> {
	if (!gatewayEnabled()) throw new HttpError(503, "Personal model gateway is not configured");
	try {
		const admin = (await readFile(process.env.BEEZY_GATEWAY_TOKEN_FILE!, "utf8")).trim();
		const response = await fetch(`${gatewayUrl()}${path}`, {
			method, redirect: "error", signal: AbortSignal.timeout(5000),
			headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: body && JSON.stringify(body),
		});
		if (response.status === 409) throw new HttpError(409, "Provider credential is missing");
		if (!response.ok) throw new Error();
		return await response.json() as T;
	} catch (error) {
		if (error instanceof HttpError) throw error;
		throw new HttpError(502, "Personal model gateway request failed");
	}
}

export const keyStatus = (tenant: string, user: string, provider: GatewayProvider) => request<{ configured: boolean }>(credential(tenant, user, provider));
export const saveGatewayKey = (tenant: string, user: string, provider: GatewayProvider, apiKey: string) => request(credential(tenant, user, provider), "PUT", { apiKey });
export const deleteGatewayKey = (tenant: string, user: string, provider: GatewayProvider) => request(credential(tenant, user, provider), "DELETE");
export async function gatewayRun(tenant: string, user: string, preferred: GatewayModel, fallback?: GatewayModel): Promise<GatewayRun> {
	for (const candidate of [preferred, fallback]) {
		if (!candidate || !(await keyStatus(tenant, user, candidate.provider)).configured) continue;
		const run = await request<Pick<GatewayRun, "token" | "runId">>("/admin/runs", "POST", { ...candidate, account: account(tenant, user), ttlSeconds: 900 });
		return { ...candidate, ...run };
	}
	throw new HttpError(409, "Add a key for your preferred or fallback provider in Model settings");
}
export const revokeGatewayRun = (runId: string) => request(`/admin/runs/${runId}`, "DELETE");