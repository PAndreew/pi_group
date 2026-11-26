/**
 * Redaction of tool output streamed live to viewers while a tool runs. Pi's extensions only rewrite final tool
 * results, so the server redacts partial output itself. The vault registers the implementation (see vault.ts), which
 * keeps harnesses free of vault imports. Without one, output passes through unchanged.
 */
type Redactor = (sessionKey: string, text: string) => Promise<string>;

let redactor: Redactor | undefined;

export function setLiveRedactor(next: Redactor | undefined) {
	redactor = next;
}

export function redactLive(sessionKey: string | undefined, text: string): Promise<string> {
	return sessionKey && redactor && text ? redactor(sessionKey, text) : Promise.resolve(text);
}
