import { z } from "zod";

export const SEARCH_PAGE = "https://search.pi-group.invalid/";
export const searchUrl = (q: string) => `${SEARCH_PAGE}?${new URLSearchParams({ q })}`;

const responseSchema = z.object({ web: z.object({ results: z.array(z.object({ title: z.string(), url: z.string(), description: z.string().optional() })) }).optional() });
const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export async function searchPage(query: string, key = process.env.BRAVE_SEARCH_API_KEY, request = fetch) {
	let content: string;
	try {
		if (!key) throw new Error("Search is not configured. Ask your administrator to set BRAVE_SEARCH_API_KEY.");
		if (query.length > 400) throw new Error("Search queries must be 400 characters or fewer.");
		const params = new URLSearchParams({ q: query, count: "10", text_decorations: "false" });
		const response = await request(`https://api.search.brave.com/res/v1/web/search?${params}`, {
			headers: { Accept: "application/json", "X-Subscription-Token": key },
			redirect: "error", signal: AbortSignal.timeout(8000),
		}).catch(() => { throw new Error("Search could not reach Brave. Try again shortly."); });
		if (!response.ok) throw new Error(`Brave Search is unavailable (HTTP ${response.status}).`);
		const parsed = responseSchema.safeParse(await response.json().catch(() => null));
		if (!parsed.success) throw new Error("Brave returned an unreadable search response.");
		const links = (parsed.data.web?.results ?? []).slice(0, 10).flatMap((result) => {
			const url = URL.parse(result.url);
			if (!url || !["https:", "http:"].includes(url.protocol) || url.username || url.password) return [];
			return [`<li><span>${escape(url.hostname)}</span><h2><a href="${escape(url.href)}">${escape(result.title)}</a></h2><p>${escape(result.description ?? "")}</p></li>`];
		});
		content = links.length ? `<ol>${links.join("")}</ol>` : "<p>No results found.</p>";
	} catch (error) {
		content = `<p>${escape(error instanceof Error ? error.message : "Search failed.")}</p>`;
	}
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Search: ${escape(query)}</title><style>body{font:16px/1.5 system-ui;margin:0 auto;max-width:48rem;padding:1rem;overflow-wrap:anywhere}ol{padding-left:1.5rem}li{margin-bottom:1.5rem}h2,p{margin:.2rem 0}h2{font-size:1.15rem}span,small{color:#555}</style><main><h1>${escape(query)}</h1><small>Powered by Brave Search</small>${content}</main></html>`;
}
