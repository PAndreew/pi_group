import assert from "node:assert/strict";
import { test } from "node:test";
import { creationOptions, sessionDefaultsSchema, type SessionDefaults } from "./preferences.js";

const defaults: SessionDefaults = { harness: "pi", model: { provider: "openai-codex", id: "gpt-6.1-sol" }, thinkingLevel: "medium" };

test("one-click creation uses saved provider, model and thinking together", () => {
	assert.deepEqual(creationOptions({ harness: "pi" }, sessionDefaultsSchema.parse(defaults)), {
		model: defaults.model, thinkingLevel: "medium",
	});
});

test("explicit model and thinking overrides win without modifying defaults", () => {
	const input = { harness: "pi", model: { provider: "other", id: "different" }, thinkingLevel: "high" };
	assert.deepEqual(creationOptions(input, defaults), { model: input.model, thinkingLevel: "high" });
	assert.equal(defaults.thinkingLevel, "medium");
});

test("defaults do not leak into another harness", () => {
	assert.deepEqual(creationOptions({ harness: "pi-durable" }, defaults), { model: undefined, thinkingLevel: undefined });
});

test("invalid and incomplete defaults are rejected", () => {
	assert.equal(sessionDefaultsSchema.safeParse({ ...defaults, thinkingLevel: "extreme" }).success, false);
	assert.equal(sessionDefaultsSchema.safeParse({ harness: "pi" }).success, false);
	assert.equal(sessionDefaultsSchema.safeParse({ ...defaults, model: { provider: "", id: "x" } }).success, false);
});
