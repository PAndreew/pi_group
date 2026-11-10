// The project_memory tool, shared by the pi RPC extension (../project-memory.mjs) and the pi-durable adapter.
// Agents get only the topic index in their first prompt and read topics with this. See docs/project-memory.md.

export const MEMORY_TOOL = {
	name: "project_memory",
	label: "Project memory",
	description: [
		"Read this project's memory: durable decisions, facts, conventions and current state, kept as topics (the topic list is in the project memory index at the start of the conversation).",
		"Give `topics` to read whole topics by name; read only those relevant to your current task. Give `query` to find lines mentioning something across all topics. With neither, lists the topics.",
	].join(" "),
	parameters: {
		type: "object",
		additionalProperties: false,
		properties: {
			topics: { type: "array", maxItems: 10, items: { type: "string", maxLength: 60 }, description: "Topic names (slugs) to read, e.g. [\"architecture\"]." },
			query: { type: "string", maxLength: 200, description: "Case-insensitive text to find across all topics." },
		},
	},
};
