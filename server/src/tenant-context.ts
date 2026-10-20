import { AsyncLocalStorage } from "node:async_hooks";

export interface Tenant {
	id: string;
	name: string;
	root: string;
	chatFolder: string;
	memberIds: string[];
}

const scope = new AsyncLocalStorage<Tenant>();
export const currentTenant = () => scope.getStore();
export const inTenant = <T>(tenant: Tenant, fn: () => T): T => scope.run(tenant, fn);
export const tenantId = () => currentTenant()?.id ?? "work";
