/**
 * Wraps a `streamSimple` handler that delegates to the appropriate built-in
 * pi-ai API implementation (Anthropic Messages / OpenAI Completions /
 * OpenAI Responses / Google Generative AI). The wrapper injects per-route
 * authentication headers plus OpenCode Console identity headers.
 *
 * OpenCode Console uses TWO different auth headers depending on the surface:
 * - /api/config (catalog): `x-org-id` (handled in `loadConsoleConfig`)
 * - /inference/<api>/v1 (chat): `x-opencode-org-id` (injected here)
 *
 * The `pi` runtime strips per-model `headers` returned by `refreshModels`
 * (see `provider-composer.applyExtension` hardcoding `headers: undefined`),
 * so we cannot rely on per-model config. The `x-opencode-org-id` header
 * MUST be supplied on each request via `extraHeaders`.
 *
 * The delegation pattern mirrors `examples/extensions/custom-provider-gitlab-duo/index.ts`:
 * we let the upstream pi-ai module handle dialect parsing and event emission,
 * and only adapt the request envelope.
 */

import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type ProviderStreams,
	type SimpleStreamOptions,
	anthropicMessagesApi,
	createAssistantMessageEventStream,
	googleGenerativeAIApi,
	openAICompletionsApi,
	openAIResponsesApi,
} from "@earendil-works/pi-ai/compat";
import { baseUrlFor, routeFor, type ApiKind } from "./endpoint.ts";

const apiMap: Record<ApiKind, () => ProviderStreams> = {
	"anthropic-messages": anthropicMessagesApi,
	"openai-completions": openAICompletionsApi,
	"openai-responses": openAIResponsesApi,
	"google-generative-ai": googleGenerativeAIApi,
};

export interface StreamContext {
	accessToken: string;
	orgId?: string;
	requestId?: string;
	clientName?: string;
	extraHeaders?: Record<string, string>;
}

/**
 * Wraps the models `baseUrl` and delegates to the built-in streaming
 * implementation. The wrapper injects per-route auth headers and OpenCode
 * Console identity headers (`x-opencode-org-id`, `x-opencode-client`).
 *
 * Returns an `AssistantMessageEventStream` immediately; the inner stream
 * runs on a microtask so callers can iterate the returned stream
 * synchronously.
 */
export function streamConsole(
	model: Model<Api>,
	context: Context,
	streamCtx: StreamContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	(async () => {
		try {
			const apiKind = model.api as ApiKind;
			const apiFactory = apiMap[apiKind];
			if (!apiFactory) {
				throw new Error(`Unsupported OpenCode Console API kind: ${String(model.api)}`);
			}
			const overridden: Model<Api> = {
				...model,
				baseUrl: baseUrlFor(model.baseUrl, apiKind),
			};

			const headers: Record<string, string> = {
				...(streamCtx.extraHeaders ?? {}),
				...(options?.headers as Record<string, string> | undefined),
				"x-opencode-client": streamCtx.clientName ?? "pi-provider-opencode-console",
			};
			// `/inference/*` requires the Console's workspace/org header.
			// `/api/config` uses `x-org-id` instead, but that's only called
			// from `loadConsoleConfig`, which is outside this code path.
			if (streamCtx.orgId) headers["x-opencode-org-id"] = streamCtx.orgId;
			if (streamCtx.requestId) headers["x-opencode-request"] = streamCtx.requestId;

			// For Anthropic and Google, the built-in API modules set their
			// own auth header (`x-api-key` / `x-goog-api-key`) from
			// `options.apiKey`. For OpenAI-compat APIs they read
			// `Authorization: Bearer` from `options.headers`. We pass
			// apiKey directly and let the inner module own its auth header.
			// route.authHeader is exposed for tests and external callers.
			void routeFor(apiKind);

			const innerOpts: SimpleStreamOptions = {
				...options,
				apiKey: streamCtx.accessToken,
				headers,
			};

			const inner = apiFactory().streamSimple(overridden, context, innerOpts);
			for await (const event of inner) {
				stream.push(event);
				if (event.type === "done" || event.type === "error") break;
			}
			stream.end();
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			const reason: "error" | "aborted" = options?.signal?.aborted ? "aborted" : "error";
			stream.push({
				type: "error",
				reason,
				error: {
					role: "assistant",
					content: [],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
					stopReason: reason,
					errorMessage,
					timestamp: Date.now(),
				},
			});
			stream.end();
		}
	})();
	return stream;
}

/**
 * Same as `streamConsole` but resolves the access token + orgId lazily via
 * `getSession`. Used by the `streamSimple` handler so that session loading
 * happens inside the returned stream's async loop (preserving the
 * synchronous-return contract).
 */
export function streamConsoleWithSession(
	model: Model<Api>,
	context: Context,
	getSession: () => Promise<StreamContext>,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	(async () => {
		try {
			const session = await getSession();
			const innerStream = streamConsole(model, context, session, options);
			for await (const event of innerStream) {
				stream.push(event);
				if (event.type === "done" || event.type === "error") break;
			}
			stream.end();
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			const reason: "error" | "aborted" = options?.signal?.aborted ? "aborted" : "error";
			stream.push({
				type: "error",
				reason,
				error: {
					role: "assistant",
					content: [],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
					stopReason: reason,
					errorMessage,
					timestamp: Date.now(),
				},
			});
			stream.end();
		}
	})();
	return stream;
}
