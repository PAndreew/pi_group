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

// Changes one part of the project's memory; agents use it when a session goes quiet (see docs/project-memory.md).
export const MEMORY_UPDATE_TOOL = {
	name: "project_memory_update",
	label: "Update project memory",
	description: [
		"Change this project's memory. action=write creates or replaces a whole topic (`topic` slug: lowercase letters, digits, dashes; plus `title`, a one-line `description` and the full Markdown `body`); read the topic first and keep what still holds.",
		"action=delete removes a topic (after merging what is worth keeping elsewhere). action=overview replaces the master overview: a few sentences that orient someone new to the project (`body`).",
		"Topics follow the nature of the project (e.g. architecture, design, marketing, business; or itinerary, budget). Add one only for substantial material that fits none of the existing ones.",
	].join(" "),
	parameters: {
		type: "object",
		additionalProperties: false,
		required: ["action"],
		properties: {
			action: { type: "string", enum: ["write", "delete", "overview"] },
			topic: { type: "string", maxLength: 40, description: "write/delete: the topic slug, e.g. \"design\"." },
			title: { type: "string", maxLength: 80, description: "write: short title." },
			description: { type: "string", maxLength: 300, description: "write: one line saying what the topic covers." },
			body: { type: "string", maxLength: 8000, description: "write: the topic's full content; overview: the overview text." },
		},
	},
};
