// Secret placeholders: agents write {{vault:KEY}} (or {{vault:project:KEY}}) where a secret belongs. The pi extension
// (../vault.mjs) puts the values into tool calls just before they run, and turns values in tool results back into
// placeholders, so the model only ever sees keys. See docs/vault.md.
//
// Values also leak in encoded form (an API echoing JSON, a URL, a Basic auth header), so redaction also looks for the
// JSON-escaped, URL-encoded, base64 and hex forms and labels them, e.g. {{vault:KEY:base64}}. Those labelled
// placeholders fill with the same encoding, so a file read back with {{vault:KEY:json}} can be edited as shown.

export const PLACEHOLDER = /\{\{vault:(?:(personal|project):)?([A-Za-z_][A-Za-z0-9_]{0,63})(?::(json|url|base64|hex))?\}\}/g;
/** Values shorter than this are not redacted: they would match ordinary text. */
export const MIN_REDACT = 6;
/** Base64 pieces of a value inside a longer base64 string (e.g. `user:password`) must be at least this long. */
const MIN_FRAGMENT = 8;

const placeholder = (s, ambiguous, encoding) => `{{vault:${ambiguous ? `${s.scope}:` : ""}${s.key}${encoding ? `:${encoding}` : ""}}}`;

const encoders = {
	json: (v) => JSON.stringify(v).slice(1, -1),
	url: (v) => encodeURIComponent(v),
	base64: (v) => Buffer.from(v, "utf8").toString("base64"),
	hex: (v) => Buffer.from(v, "utf8").toString("hex"),
};

/**
 * The base64 characters that encode `value` wherever it starts inside a longer base64 string: for each of the three
 * byte alignments, the characters that depend on the value's bytes only.
 */
function base64Fragments(value) {
	const bytes = Buffer.from(value, "utf8");
	const fragments = [];
	for (const shift of [0, 1, 2]) {
		const encoded = Buffer.concat([Buffer.alloc(shift), bytes]).toString("base64");
		const head = [0, 2, 3][shift];
		const tail = Math.floor((shift + bytes.length) / 3) * 4;
		const fragment = encoded.slice(head, tail);
		if (fragment.length >= MIN_FRAGMENT) fragments.push(fragment);
	}
	return fragments;
}

/** Every form of a secret worth redacting, with the placeholder that replaces it. */
function needles(s, ambiguous) {
	const out = new Map();
	const add = (text, replacement) => { if (text && !out.has(text)) out.set(text, replacement); };
	add(s.value, placeholder(s, ambiguous));
	add(encoders.json(s.value), placeholder(s, ambiguous, "json"));
	add(encoders.json(s.value).replaceAll("/", "\\/"), placeholder(s, ambiguous, "json"));
	add(encoders.url(s.value), placeholder(s, ambiguous, "url"));
	add(encoders.url(s.value).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()), placeholder(s, ambiguous, "url"));
	add(encoders.url(s.value).replaceAll("%20", "+"), placeholder(s, ambiguous, "url"));
	const base64 = encoders.base64(s.value);
	add(base64, placeholder(s, ambiguous, "base64"));
	add(base64.replace(/=+$/, ""), placeholder(s, ambiguous, "base64"));
	add(base64.replace(/=+$/, "").replaceAll("+", "-").replaceAll("/", "_"), placeholder(s, ambiguous, "base64"));
	for (const fragment of base64Fragments(s.value)) {
		add(fragment, placeholder(s, ambiguous, "base64"));
		add(fragment.replaceAll("+", "-").replaceAll("/", "_"), placeholder(s, ambiguous, "base64"));
	}
	add(encoders.hex(s.value), placeholder(s, ambiguous, "hex"));
	add(encoders.hex(s.value).toUpperCase(), placeholder(s, ambiguous, "hex"));
	return out;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lookup of secrets ({ key, scope, value }[]): personal wins over project unless the placeholder names a scope. */
export function vaultIndex(secrets) {
	const find = (key, scope) => secrets.find((s) => s.key === key && s.scope === scope);
	const resolve = (key, scope) => scope ? find(key, scope) : find(key, "personal") ?? find(key, "project");
	const both = new Set(secrets.filter((s) => secrets.some((o) => o !== s && o.key === s.key)).map((s) => s.key));
	const replacements = new Map();
	for (const s of secrets) {
		if (!s.value || s.value.length < MIN_REDACT) continue;
		for (const [text, replacement] of needles(s, both.has(s.key) && s.scope === "project")) if (!replacements.has(text)) replacements.set(text, replacement);
	}
	// One pass, longest first, so a value is never matched inside a placeholder written earlier.
	const pattern = replacements.size ? new RegExp([...replacements.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|"), "g") : undefined;
	return {
		/** Text with placeholders replaced by values (encoded when the placeholder says so); `missing` lists placeholders without a secret. */
		fill(text, missing) {
			return text.replace(PLACEHOLDER, (match, scope, key, encoding) => {
				const s = resolve(key, scope);
				if (!s) { missing.add(match); return match; }
				return encoding ? encoders[encoding](s.value) : s.value;
			});
		},
		/** Text with every known value, plain or encoded, replaced by its placeholder. */
		redact(text) {
			return pattern ? text.replace(pattern, (match) => replacements.get(match)) : text;
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
