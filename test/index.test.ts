import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import providerFactory from "../src/index.ts";

// Capture the registered providers + commands.
interface CapturedProvider {
	name: string;
	config: Record<string, unknown>;
}

function makeFakePi() {
	const providers: CapturedProvider[] = [];
	const commands: { name: string; handler: (args: string, ctx: unknown) => Promise<void> }[] = [];
	return {
		providers,
		commands,
		registerProvider(name: string, config: Record<string, unknown>) {
			providers.push({ name, config });
		},
		registerCommand(name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) {
			commands.push({ name, handler: options.handler });
		},
	};
}

const cast = (x: unknown) => x as never;

/**
 * Build a temporary auth.json so the extension thinks a user is signed in.
 */
async function withAuthFile(
	content: object,
	fn: () => Promise<void>,
): Promise<void> {
	const dir = join(tmpdir(), `pi-provider-opencode-console-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	await mkdir(dir, { recursive: true });
	const fakeHome = join(dir, "home");
	await mkdir(fakeHome, { recursive: true });
	const fakeAuthDir = join(fakeHome, ".pi", "agent");
	await mkdir(fakeAuthDir, { recursive: true });
	await writeFile(join(fakeAuthDir, "auth.json"), JSON.stringify(content), { mode: 0o600 });
	process.env.HOME = fakeHome;
	try {
		await fn();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("extension registers a provider named opencode-console", async () => {
	const pi = makeFakePi();
	providerFactory(cast(pi));
	assert.equal(pi.providers.length, 1);
	assert.equal(pi.providers[0]!.name, "opencode-console");
	const cfg = pi.providers[0]!.config as {
		name?: string;
		models?: unknown[];
		oauth?: { name?: string; isSubscription?: boolean; login?: unknown; refreshToken?: unknown; getApiKey?: unknown };
		refreshModels?: unknown;
		streamSimple?: unknown;
	};
	assert.equal(cfg.name, "OpenCode Console");
	assert.deepEqual(cfg.models, []);
	assert.ok(cfg.oauth);
	assert.equal(cfg.oauth!.name, "OpenCode Console (device sign-in)");
	assert.equal(cfg.oauth!.isSubscription, true);
	assert.equal(typeof cfg.oauth!.login, "function");
	assert.equal(typeof cfg.oauth!.refreshToken, "function");
	assert.equal(typeof cfg.oauth!.getApiKey, "function");
	assert.equal(typeof cfg.refreshModels, "function");
	assert.equal(typeof cfg.streamSimple, "function");
});

test("extension registers /opencode-console command", async () => {
	const pi = makeFakePi();
	providerFactory(cast(pi));
	assert.equal(pi.commands.length, 1);
	assert.equal(pi.commands[0]!.name, "opencode-console");
});

test("refreshModels returns [] when no orgId in auth.json", async () => {
	const pi = makeFakePi();
	providerFactory(cast(pi));
	const provider = pi.providers[0]!;
	const refreshModels = provider.config.refreshModels as (ctx: unknown) => Promise<unknown[]>;
	await withAuthFile(
		{
			"opencode-console": {
				type: "oauth",
				refresh: "rt",
				access: "at",
				expires: Date.now() + 60 * 60_000,
				env: {
					OPENCODE_CONSOLE_SERVER: "https://console.example.test",
					OPENCODE_CONSOLE_ACCOUNT_ID: "acct",
					OPENCODE_CONSOLE_EMAIL: "u@example.test",
				},
			},
		},
		async () => {
			const result = await refreshModels({});
			assert.deepEqual(result, []);
		},
	);
});

test("refreshModels calls /api/config when org is present", async () => {
	const pi = makeFakePi();
	providerFactory(cast(pi));
	const provider = pi.providers[0]!;
	const refreshModels = provider.config.refreshModels as (
		ctx: { signal?: AbortSignal; publish?: (p: { persist: unknown }) => Promise<boolean> },
	) => Promise<Array<{ id: string }>>;
	let captured: Record<string, string> | undefined;
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
		req.on("end", () => {
			captured = Object.fromEntries(
				Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : (v ?? "")]),
			) as Record<string, string>;
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					config: {
						provider: {
							opencode: {
								api: "https://api.example.test/v1",
								models: {
									"claude-x": {
										name: "Claude X",
										reasoning: false,
										limit: { context: 200_000, output: 8_192 },
									},
								},
							},
						},
					},
				}),
			);
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const port = (server.address() as AddressInfo).port;
	const serverUrl = `http://127.0.0.1:${port}`;
	try {
		await withAuthFile(
			{
				"opencode-console": {
					type: "oauth",
					refresh: "rt",
					access: "at",
					expires: Date.now() + 60 * 60_000,
					env: {
						OPENCODE_CONSOLE_SERVER: serverUrl,
						OPENCODE_CONSOLE_ACCOUNT_ID: "acct",
						OPENCODE_CONSOLE_EMAIL: "u@example.test",
						OPENCODE_CONSOLE_ORG_ID: "org-1",
						OPENCODE_CONSOLE_ORG_NAME: "Org One",
					},
				},
			},
			async () => {
				let published: { persist: unknown } | undefined;
				const models = await refreshModels({
					publish: (p: { persist: unknown }) => {
						published = p;
						return Promise.resolve(true);
					},
				});
				assert.equal(models.length, 1);
				assert.equal(models[0]!.id, "claude-x");
				assert.ok(published, "expected publish() to be called");
				assert.ok(captured);
				assert.equal(captured!["x-org-id"], "org-1");
				assert.equal(captured!["authorization"], "Bearer at");
			},
		);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((r) => server.close(() => r()));
	}
});

test("refreshModels returns [] when /api/config fails", async () => {
	const pi = makeFakePi();
	providerFactory(cast(pi));
	const provider = pi.providers[0]!;
	const refreshModels = provider.config.refreshModels as (
		ctx: { signal?: AbortSignal; publish?: (p: { persist: unknown }) => Promise<boolean> },
	) => Promise<unknown[]>;
	const server = createServer((req, res) => {
		req.on("data", () => {});
		req.on("end", () => {
			res.writeHead(500);
			res.end("server error");
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const port = (server.address() as AddressInfo).port;
	const serverUrl = `http://127.0.0.1:${port}`;
	try {
		await withAuthFile(
			{
				"opencode-console": {
					type: "oauth",
					refresh: "rt",
					access: "at",
					expires: Date.now() + 60 * 60_000,
					env: {
						OPENCODE_CONSOLE_SERVER: serverUrl,
						OPENCODE_CONSOLE_ACCOUNT_ID: "acct",
						OPENCODE_CONSOLE_EMAIL: "u@example.test",
						OPENCODE_CONSOLE_ORG_ID: "org-1",
					},
				},
			},
			async () => {
				const models = await refreshModels({});
				assert.deepEqual(models, []);
			},
		);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((r) => server.close(() => r()));
	}
});

test("getApiKey returns the access token", async () => {
	const pi = makeFakePi();
	providerFactory(cast(pi));
	const provider = pi.providers[0]!;
	const oauth = provider.config.oauth as { getApiKey: (c: { access: string }) => string };
	assert.equal(oauth.getApiKey({ access: "abc" }), "abc");
});

test("command warns when not signed in", async () => {
	const pi = makeFakePi();
	providerFactory(cast(pi));
	const handler = pi.commands[0]!.handler;
	const notifications: { message: string; type?: string }[] = [];
	const fakeCtx = {
		ui: {
			notify: (message: string, type?: string) => notifications.push({ message, type }),
			select: async () => undefined,
			confirm: async () => false,
			input: async () => undefined,
		},
	};
	await handler("", fakeCtx);
	assert.equal(notifications.length, 1);
	assert.match(notifications[0]!.message, /Not signed in/);
});

test("oauth.login returns credentials with env block", async () => {
	// Drive the OAuth login flow end-to-end against a fake console + fake
	// pi callbacks. The returned OAuthCredentials must include the env block
	// (server, orgId, accountId, email) so pi persists it to auth.json.
	const fakeConsole = createServer((req, res) => {
		const url = String(req.url);
		let body = "";
		req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
		req.on("end", () => {
			if (url.endsWith("/auth/device/code")) {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						device_code: "dev-1",
						user_code: "ABCD-1234",
						verification_uri_complete: "https://console.example.test/activate",
						expires_in: 600,
						interval: 1,
					}),
				);
				return;
			}
			if (url.endsWith("/auth/device/token")) {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						access_token: "at-login",
						refresh_token: "rt-login",
						expires_in: 3600,
					}),
				);
				return;
			}
			if (url.endsWith("/api/user")) {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ id: "acct-1", email: "u@example.test" }));
				return;
			}
			if (url.endsWith("/api/orgs")) {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify([{ id: "org-7", name: "Org Seven" }]));
				return;
			}
			res.writeHead(404);
			res.end();
		});
	});
	await new Promise<void>((r) => fakeConsole.listen(0, "127.0.0.1", r));
	const port = (fakeConsole.address() as AddressInfo).port;
	const serverUrl = `http://127.0.0.1:${port}`;
	process.env.OPENCODE_CONSOLE_SERVER = serverUrl;

	const pi = makeFakePi();
	providerFactory(cast(pi));
	const provider = pi.providers[0]!;
	const oauth = provider.config.oauth as {
		login: (callbacks: unknown) => Promise<{ refresh: string; access: string; expires: number; env?: Record<string, string> }>;
	};
	const callbacks = {
		onDeviceCode: () => {},
		onAuth: () => {},
		onPrompt: async () => "",
		onProgress: () => {},
		onSelect: async () => undefined,
		signal: new AbortController().signal,
	};
	const credentials = await oauth.login(callbacks);
	try {
		assert.equal(credentials.refresh, "rt-login");
		assert.equal(credentials.access, "at-login");
		assert.ok(credentials.env, "login must return an env block");
		assert.equal(credentials.env!.OPENCODE_CONSOLE_SERVER, serverUrl);
		assert.equal(credentials.env!.OPENCODE_CONSOLE_ACCOUNT_ID, "acct-1");
		assert.equal(credentials.env!.OPENCODE_CONSOLE_EMAIL, "u@example.test");
		assert.equal(credentials.env!.OPENCODE_CONSOLE_ORG_ID, "org-7");
		assert.equal(credentials.env!.OPENCODE_CONSOLE_ORG_NAME, "Org Seven");
	} finally {
		fakeConsole.closeAllConnections();
		await new Promise<void>((r) => fakeConsole.close(() => r()));
		delete process.env.OPENCODE_CONSOLE_SERVER;
	}
});

test("oauth.refreshToken returns refreshed credentials with env block", async () => {
	// Seed auth.json with an expiring session and a fake console that
	// answers refresh-token POSTs. The refresh must return env so pi does
	// not drop the orgId/server on the next refresh.
	const fakeConsole = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
		req.on("end", () => {
			if (String(req.url).endsWith("/auth/device/token")) {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						access_token: "at-refreshed",
						refresh_token: "rt-refreshed",
						expires_in: 7200,
					}),
				);
				return;
			}
			res.writeHead(404);
			res.end();
		});
	});
	await new Promise<void>((r) => fakeConsole.listen(0, "127.0.0.1", r));
	const port = (fakeConsole.address() as AddressInfo).port;
	const serverUrl = `http://127.0.0.1:${port}`;
	try {
		await withAuthFile(
			{
				"opencode-console": {
					type: "oauth",
					refresh: "rt-old",
					access: "at-old",
					expires: Date.now() - 1_000, // already expired
					env: {
						OPENCODE_CONSOLE_SERVER: serverUrl,
						OPENCODE_CONSOLE_ACCOUNT_ID: "acct-1",
						OPENCODE_CONSOLE_EMAIL: "u@example.test",
						OPENCODE_CONSOLE_ORG_ID: "org-7",
						OPENCODE_CONSOLE_ORG_NAME: "Org Seven",
					},
				},
			},
			async () => {
				const pi = makeFakePi();
				providerFactory(cast(pi));
				const provider = pi.providers[0]!;
				const oauth = provider.config.oauth as {
					refreshToken: (
						c: unknown,
						signal: AbortSignal,
					) => Promise<{ refresh: string; access: string; expires: number; env?: Record<string, string> }>;
				};
				const out = await oauth.refreshToken(
					{ refresh: "rt-old", access: "at-old", expires: 0 },
					new AbortController().signal,
				);
				assert.equal(out.access, "at-refreshed");
				assert.equal(out.refresh, "rt-refreshed");
				assert.ok(out.env, "refreshToken must return an env block");
				assert.equal(out.env!.OPENCODE_CONSOLE_SERVER, serverUrl);
				assert.equal(out.env!.OPENCODE_CONSOLE_ORG_ID, "org-7");
				assert.equal(out.env!.OPENCODE_CONSOLE_ORG_NAME, "Org Seven");
			},
		);
	} finally {
		fakeConsole.closeAllConnections();
		await new Promise<void>((r) => fakeConsole.close(() => r()));
	}
});
