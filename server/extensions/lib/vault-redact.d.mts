type Secret = { key: string; scope: "personal" | "project"; value: string };
export declare const PLACEHOLDER: RegExp;
export declare const MIN_REDACT: number;
export declare function vaultIndex(secrets: Secret[]): { fill(text: string, missing: Set<string>): string; redact(text: string): string };
export declare function mapStrings<T>(value: T, fn: (text: string) => string): T;
