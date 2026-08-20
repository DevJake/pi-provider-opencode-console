/**
 * Loads the org-scoped model catalog from OpenCode Console `/api/config`
 * and projects it to pi's `ProviderModelConfig` shape.
 */

import { resolveRoute, type ApiKind } from "./endpoint.ts";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

// Raw shape returned by OpenCode Console `/api/config`.
// Documented in opencode's `packages/core/src/plugin/provider/opencode.ts`.

export interface ModelConfigSource {
	id?: unknown;
	name?: unknown;
	family?: unknown;
	status?: unknown;
	disabled?: unknown;
	reasoning?: unknown;
	modalities?: { input?: unknown };
	attachment?: unknown;
	tool_call?: unknown;
	provider?: { npm?: unknown; api?: unknown };
	cost?: { input?: unknown; output?: unknown; cache_read?: unknown; cache_write?: unknown };
	limit?: { context?: unknown; output?: unknown; input?: unknown };
	options?: Record<string, unknown>;
	headers?: Record<string, unknown>;
}

export interface ProviderSource {
	name?: unknown;
	npm?: unknown;
	api?: unknown;
	options?: { headers?: Record<string, unknown> };
	models?: Record<string, ModelConfigSource>;
	[key: string]: unknown;
}

function num(v: unknown, fallback: number): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function stringField(obj: Record<string, unknown> | undefined, key: string): string | undefined {
	const v = obj?.[key];
	return typeof v === "string" ? v : undefined;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
	if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
	return undefined;
}

function imageCapable(source: ModelConfigSource): boolean {
	const inputs = source.modalities?.input;
	if (Array.isArray(inputs) && inputs.includes("image")) return true;
	return source.attachment === true;
}

function stringHeaders(record: Record<string, unknown> | undefined): Record<string, string> | undefined {
	if (!record) return undefined;
	const out: Record<string, string> = {};
	let any = false;
	for (const [k, v] of Object.entries(record)) {
		if (typeof v === "string") {
			out[k] = v;
			any = true;
		}
	}
	return any ? out : undefined;
}

export async function loadConsoleConfig(
	server: string,
	token: string,
	orgId: string,
	fetcher: typeof fetch = fetch,
	signal?: AbortSignal,
): Promise<Map<string, ProviderSource>> {
	const baseUrl = server.replace(/\/+$/, "");
	const response = await fetcher(`${baseUrl}/api/config`, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${token}`,
			"x-org-id": orgId,
		},
		signal,
	});
	if (response.status === 404) {
		throw new Error("This OpenCode Console server does not expose organization configuration");
	}
	if (!response.ok) {
		throw new Error(`OpenCode Console model configuration failed (${response.status})`);
	}
	const json = (await response.json()) as { config?: { provider?: Record<string, ProviderSource> } };
	const providers = json.config?.provider ?? {};
	return new Map(Object.entries(providers));
}

export interface BuiltModel {
	id: string;
	name: string;
	provider: "opencode-console";
	api: ApiKind;
	baseUrl: string;
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	headers?: Record<string, string>;
}

export function buildPiModels(providers: Map<string, ProviderSource>): BuiltModel[] {
	// First pass: collect entries and a list of (providerId, rawId) pairs.
	const entries: BuiltModel[] = [];
	const ownerByModelId = new Map<string, string[]>();

	for (const [providerId, provider] of providers) {
		for (const [rawId, source] of Object.entries(provider.models ?? {})) {
			if (source.status === "deprecated" || source.disabled === true) continue;
			const modelId = typeof source.id === "string" ? source.id : rawId;
			const api = resolveRoute(modelId, stringField(asRecord(source.provider), "npm") ?? stringField(provider, "npm"));
			const baseUrl = stringField(asRecord(source.provider), "api") ?? stringField(provider, "api") ?? "";
			if (!baseUrl) continue; // can't route without a base URL
			const context = num(source.limit?.context, 32_768);
			const output = num(source.limit?.output, Math.min(context, 8_192));
			const providerHeaders = stringHeaders(provider.options?.headers);
			const modelHeaders = stringHeaders(source.headers);
			const mergedHeaders = providerHeaders || modelHeaders
				? { ...(providerHeaders ?? {}), ...(modelHeaders ?? {}) }
				: undefined;
			entries.push({
				id: rawId,
				name: typeof source.name === "string" ? source.name : rawId,
				provider: "opencode-console",
				api,
				baseUrl,
				contextWindow: context,
				maxTokens: output,
				reasoning: source.reasoning === true,
				input: imageCapable(source) ? ["text", "image"] : ["text"],
				cost: {
					input: num(source.cost?.input, 0),
					output: num(source.cost?.output, 0),
					cacheRead: num(source.cost?.cache_read, 0),
					cacheWrite: num(source.cost?.cache_write, 0),
				},
				headers: mergedHeaders,
			});
			const owners = ownerByModelId.get(rawId) ?? [];
			owners.push(providerId);
			ownerByModelId.set(rawId, owners);
		}
	}

	// Disambiguate duplicate raw ids by prefixing with providerId.
	const duplicateIds = new Set<string>();
	for (const [id, owners] of ownerByModelId) {
		if (owners.length > 1) duplicateIds.add(id);
	}
	if (duplicateIds.size === 0) return entries;

	// Build an index entry(rawId) -> providerId using insertion order so
	// disambiguation is deterministic.
	const providerForRawId = new Map<string, string>();
	for (const [rawId, owners] of ownerByModelId) {
		if (owners.length === 1) {
			providerForRawId.set(rawId, owners[0]!);
		}
	}
	// Now walk again, picking the provider that owns the entry.
	return entries.map((e) => {
		if (!duplicateIds.has(e.id)) return e;
		const owners = ownerByModelId.get(e.id) ?? [];
		// Pick by baseUrl match against the owning provider's api url.
		const ownerProvider = owners.find((pid) => {
			const provider = providers.get(pid);
			const api = stringField(asRecord(provider?.models?.[e.id]?.provider), "api") ?? stringField(provider, "api");
			return api === e.baseUrl;
		}) ?? owners[0]!;
		void providerForRawId;
		return { ...e, id: `${ownerProvider}/${e.id}` };
	});
}

/**
 * Convert BuiltModel entries to pi's `ProviderModelConfig` shape.
 */
export function toProviderModelConfigs(entries: BuiltModel[]): ProviderModelConfig[] {
	return entries.map((m) => ({
		id: m.id,
		name: m.name,
		api: m.api as ApiKind & ProviderModelConfig["api"],
		baseUrl: m.baseUrl,
		contextWindow: m.contextWindow,
		maxTokens: m.maxTokens,
		reasoning: m.reasoning,
		input: m.input,
		cost: m.cost,
		...(m.headers ? { headers: m.headers } : {}),
	}));
}
