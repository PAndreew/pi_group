// Secret placeholders: agents write {{vault:KEY}} (or {{vault:project:KEY}}) where a secret belongs. The pi extension
// (../vault.mjs) puts the values into tool calls just before they run, and turns values in tool results back into
// placeholders, so the model only ever sees keys. See docs/vault.md.

export const PLACEHOLDER = /\{\{vault:(?:(personal|project):)?([A-Za-z_][A-Za-z0-9_]{0,63})\}\}/g;
/** Values shorter than this are not redacted: they would match ordinary text. */
export const MIN_REDACT = 6;

const placeholder = (s, ambiguous) => ambiguous ? `{{vault:${s.scope}:${s.key}}}` : `{{vault:${s.key}}}`;

/** Lookup of secrets ({ key, scope, value }[]): personal wins over project unless the placeholder names a scope. */
export function vaultIndex(secrets) {
	const find = (key, scope) => secrets.find((s) => s.key === key && (!scope || s.scope === scope)) ?? (scope ? undefined : undefined);
	const resolve = (key, scope) => scope ? find(key, scope) : find(key, "personal") ?? find(key, "project");
	const both = new Set(secrets.filter((s) => secrets.some((o) => o !== s && o.key === s.key)).map((s) => s.key));
	const redactable = secrets.filter((s) => s.value && s.value.length >= MIN_REDACT).sort((a, b) => b.value.length - a.value.length);
	return {
		/** Text with placeholders replaced by values; `missing` lists placeholders without a secret. */
		fill(text, missing) {
			return text.replace(PLACEHOLDER, (match, scope, key) => {
				const s = resolve(key, scope);
				if (!s) { missing.add(match); return match; }
				return s.value;
			});
		},
		/** Text with every known value replaced by its placeholder. */
		redact(text) {
			let out = text;
			for (const s of redactable) if (out.includes(s.value)) out = out.split(s.value).join(placeholder(s, both.has(s.key) && s.scope === "project"));
			return out;
		},
	};
}

/** Apply `fn` to every string inside a JSON-like value, in place for objects and arrays; returns the new value. */
export function mapStrings(value, fn) {
	if (typeof value === "string") return fn(value);
	if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) value[i] = mapStrings(value[i], fn); return value; }
	if (value && typeof value === "object") { for (const k of Object.keys(value)) value[k] = mapStrings(value[k], fn); return value; }
	return value;
}
