import test from "node:test";
import assert from "node:assert/strict";
import { buildPiModels, loadConsoleConfig, toProviderModelConfigs } from "../src/models.ts";

const sampleConfig = {
	config: {
		provider: {
			opencode: {
				api: "https://api.example.test/v1",
				models: {
					"claude-x": {
						name: "Claude X",
						reasoning: false,
						tool_call: true,
						limit: { context: 200_000, output: 8_192 },
						modalities: { input: ["text", "image"] },
						cost: { input: 3, output: 15 },
					},
					"gpt-y": {
						name: "GPT Y",
						reasoning: true,
						limit: { context: 128_000, output: 16_384 },
					},
					"deprecated-z": { status: "deprecated" },
					"disabled-w": { disabled: true },
				},
			},
		},
	},
};

test("loadConsoleConfig sends x-org-id", async () => {
	let requestedHeaders: Record<string, string> | undefined;
	const fetcher: typeof fetch = async (_input, init) => {
		requestedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
		return new Response(JSON.stringify(sampleConfig), { status: 200 });
	};
	const result = await loadConsoleConfig("https://console.example.test", "tok", "org-1", fetcher);
	assert.equal(requestedHeaders!["x-org-id"], "org-1");
	// Headers are normalized to lowercase by the Headers spec.
	assert.equal(requestedHeaders!.authorization, "Bearer tok");
	assert.equal(result.size, 1);
});

test("loadConsoleConfig 404 throws descriptive error", async () => {
	const fetcher: typeof fetch = async () => new Response("", { status: 404 });
	await assert.rejects(
		loadConsoleConfig("https://console.example.test", "t", "o", fetcher),
		/does not expose organization/,
	);
});

test("loadConsoleConfig 500 surfaces status code", async () => {
	const fetcher: typeof fetch = async () => new Response("", { status: 500 });
	await assert.rejects(
		loadConsoleConfig("https://console.example.test", "t", "o", fetcher),
		/500/,
	);
});

test("buildPiModels skips deprecated and disabled", () => {
	const map = new Map(Object.entries(sampleConfig.config.provider));
	const models = buildPiModels(map);
	const ids = models.map((m) => m.id).sort();
	assert.deepEqual(ids, ["claude-x", "gpt-y"]);
});

test("buildPiModels maps reasoning + image input + cost + context", () => {
	const map = new Map(Object.entries(sampleConfig.config.provider));
	const models = buildPiModels(map);
	const claude = models.find((m) => m.id === "claude-x")!;
	assert.equal(claude.reasoning, false);
	assert.deepEqual(claude.input, ["text", "image"]);
	assert.equal(claude.contextWindow, 200_000);
	assert.equal(claude.maxTokens, 8_192);
	assert.equal(claude.cost.input, 3);
	assert.equal(claude.cost.output, 15);
	assert.equal(claude.cost.cacheRead, 0);
	assert.equal(claude.cost.cacheWrite, 0);
	assert.equal(claude.baseUrl, "https://api.example.test/v1");

	const gpt = models.find((m) => m.id === "gpt-y")!;
	assert.equal(gpt.reasoning, true);
	assert.deepEqual(gpt.input, ["text"]);
	assert.equal(gpt.api, "openai-responses");
});

test("buildPiModels uses model-level provider override", () => {
	const config = {
		config: {
			provider: {
				anthropic: {
					api: "https://api.anthropic.com/v1",
					models: {
						"claude-x": {
							name: "Claude X",
							provider: { api: "https://proxy.example.test/v1" },
						},
					},
				},
			},
		},
	};
	const map = new Map(Object.entries(config.config.provider));
	const models = buildPiModels(map);
	assert.equal(models[0].baseUrl, "https://proxy.example.test/v1");
	assert.equal(models[0].api, "anthropic-messages");
});

test("buildPiModels merges provider-level and model-level headers", () => {
	const config = {
		config: {
			provider: {
				opencode: {
					api: "https://api.example.test/v1",
					options: { headers: { "x-provider": "yes" } },
					models: {
						"gpt-y": {
							name: "GPT Y",
							headers: { "x-model": "also" },
						},
					},
				},
			},
		},
	};
	const map = new Map(Object.entries(config.config.provider));
	const models = buildPiModels(map);
	assert.deepEqual(models[0].headers, { "x-provider": "yes", "x-model": "also" });
});

test("buildPiModels disambiguates duplicate raw ids across providers", () => {
	const config = {
		config: {
			provider: {
				anthropic: {
					api: "https://api.anthropic.com/v1",
					models: { shared: { name: "A shared" } },
				},
				openai: {
					api: "https://api.openai.com/v1",
					models: { shared: { name: "O shared" } },
				},
			},
		},
	};
	const map = new Map(Object.entries(config.config.provider));
	const models = buildPiModels(map);
	const ids = models.map((m) => m.id).sort();
	assert.deepEqual(ids, ["anthropic/shared", "openai/shared"]);
});

test("buildPiModels skips models without baseUrl", () => {
	const config = {
		config: {
			provider: {
				opencode: {
					// no api at provider level
					models: { missing: { name: "M" } },
				},
			},
		},
	};
	const map = new Map(Object.entries(config.config.provider));
	const models = buildPiModels(map);
	assert.equal(models.length, 0);
});

test("toProviderModelConfigs maps all required fields", () => {
	const map = new Map(Object.entries(sampleConfig.config.provider));
	const models = buildPiModels(map);
	const configs = toProviderModelConfigs(models);
	assert.equal(configs.length, 2);
	for (const c of configs) {
		assert.ok(typeof c.id === "string");
		assert.ok(typeof c.name === "string");
		assert.ok(typeof c.api === "string");
		assert.ok(typeof c.baseUrl === "string");
		assert.ok(typeof c.contextWindow === "number");
		assert.ok(typeof c.maxTokens === "number");
		assert.ok(typeof c.reasoning === "boolean");
		assert.ok(Array.isArray(c.input));
		assert.ok(typeof c.cost === "object");
	}
});
