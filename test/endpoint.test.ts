import test from "node:test";
import assert from "node:assert/strict";
import { resolveRoute, routeFor, baseUrlFor } from "../src/endpoint.ts";

test("resolveRoute by npm package", () => {
	assert.equal(resolveRoute("foo", "@ai-sdk/anthropic"), "anthropic-messages");
	assert.equal(resolveRoute("foo", "@ai-sdk/google"), "google-generative-ai");
	assert.equal(resolveRoute("foo", "@ai-sdk/openai"), "openai-responses");
	assert.equal(resolveRoute("foo", "@ai-sdk/openai-compatible"), "openai-completions");
});

test("resolveRoute by model id prefix when npm absent", () => {
	assert.equal(resolveRoute("gpt-5"), "openai-responses");
	assert.equal(resolveRoute("claude-sonnet-4-5"), "anthropic-messages");
});

test("resolveRoute defaults to openai-completions", () => {
	assert.equal(resolveRoute("llama-3"), "openai-completions");
	assert.equal(resolveRoute("llama-3", "@ai-sdk/anthropic"), "anthropic-messages");
});

test("routeFor emits correct auth headers", () => {
	const anthropic = routeFor("anthropic-messages");
	assert.deepEqual(anthropic.authHeader("t"), {
		"x-api-key": "t",
		"anthropic-version": "2023-06-01",
	});

	const openaiResp = routeFor("openai-responses");
	assert.equal(openaiResp.authHeader("t").Authorization, "Bearer t");

	const openaiChat = routeFor("openai-completions");
	assert.equal(openaiChat.authHeader("t").Authorization, "Bearer t");

	const google = routeFor("google-generative-ai");
	assert.equal(google.authHeader("t")["x-goog-api-key"], "t");
});

test("baseUrlFor strips /v1 for anthropic", () => {
	assert.equal(baseUrlFor("https://api.anthropic.com/v1", "anthropic-messages"), "https://api.anthropic.com");
	assert.equal(baseUrlFor("https://api.anthropic.com/v1/", "anthropic-messages"), "https://api.anthropic.com");
});

test("baseUrlFor keeps /v1 for openai-completions and openai-responses", () => {
	assert.equal(baseUrlFor("https://api.openai.com/v1", "openai-completions"), "https://api.openai.com/v1");
	assert.equal(baseUrlFor("https://api.openai.com/v1/", "openai-responses"), "https://api.openai.com/v1");
});

test("baseUrlFor keeps google-generative-ai base", () => {
	assert.equal(
		baseUrlFor("https://generativelanguage.googleapis.com/v1beta", "google-generative-ai"),
		"https://generativelanguage.googleapis.com/v1beta",
	);
	assert.equal(
		baseUrlFor("https://generativelanguage.googleapis.com/v1beta/", "google-generative-ai"),
		"https://generativelanguage.googleapis.com/v1beta",
	);
});
