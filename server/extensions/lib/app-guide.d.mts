type Tool = { name: string; label: string; description: string; parameters: Record<string, unknown> };
export interface Surface { id: string; title: string; doc?: string; when: string; admin?: boolean; params?: Record<string, string> }
export declare const DOCS_DIR: string;
export declare const SURFACES: Surface[];
export declare const SURFACE_IDS: string[];
export declare function appGuide(): string;
export declare const DOCS_TOOL: Tool;
export declare function apiRoutes(dir?: string): string;
export declare function docsAnswer(args?: { topic?: string; query?: string }): string;
