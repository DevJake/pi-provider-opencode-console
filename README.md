<p align="center">
  <img src="assets/cover.jpg" alt="OpenCode Console provider for Pi" width="800">
</p>

# pi-provider-opencode-console

[![npm](https://img.shields.io/npm/v/pi-provider-opencode-console)](https://www.npmjs.com/package/pi-provider-opencode-console)
[![CI](https://github.com/grikomsn/pi-provider-opencode-console/actions/workflows/ci.yml/badge.svg)](https://github.com/grikomsn/pi-provider-opencode-console/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A [Pi](https://github.com/earendil-works/pi-coding-agent) provider for [OpenCode Console](https://opencode.ai/console) that signs in via the OAuth 2.0 device authorization grant and discovers account-specific models from the org-scoped `/api/config` endpoint. Ships two providers mirroring OpenCode's two auth systems: **OpenCode Console** (`opencode-console`) and **OpenCode Go** (`opencode-go-console`) — both support device-code sign-in and `sk-` service keys.

## Features

- OAuth 2.0 device authorization grant (RFC 8628) sign-in via `/login opencode-console` (and `/login opencode-go-console` — Go reuses the shared Console device flow)
- Service-key auth via pi's standard `auth.json` `api_key` entries (no custom secret stores)
- Console: per-org model discovery from the org-scoped `GET /api/config` endpoint; with a service key, the public `GET https://opencode.ai/zen/v1/models` catalog
- Go: the public `GET https://opencode.ai/zen/go/v1/models` catalog (the auth-ignored `lite` list), requests targeting the Go gateway
- Public catalog rows are enriched from models.dev and drop disabled/deprecated ids
- Routes chat requests to the right upstream wire API per-model (`anthropic-messages`, `openai-completions`, `openai-responses`, `google-generative-ai`)
- Delegates streaming and parsing to pi-ai's built-in implementations
- Auto-refreshes the OAuth access token within 5 minutes of expiry, single-flight, with rotated tokens mirrored across both provider entries (shared device-flow session)
- Org selection at sign-in and via `/opencode-console switch-org`
- Adds `/opencode-console` and `/opencode-go-console` for `status`, `refresh`, `logout` (Console also `switch-org`)
- Optional `OPENCODE_CONSOLE_SERVER` override for self-hosted consoles

## Install

```sh
pi install npm:pi-provider-opencode-console
```

To try a local checkout:

```sh
pi -e ./src/index.ts
```

## Authenticate

OpenCode has two auth systems — **Console** (which absorbed Zen) and **Go** (the subscription gateway). Both accept device-code sessions and workspace `sk-` service keys; pi stores exactly one credential per provider id in `~/.pi/agent/auth.json`, so a stored credential owns the provider.

### 1. Device-code sign-in (either provider)

```
/login opencode-console
# …or, for the Go gateway:
/login opencode-go-console
```

Pi prints a user code and the verification URL. Approve the sign-in in your browser. For Console, if your account has multiple orgs, Pi prompts you to pick one (persisted to `auth.json`); Go orgs are the Console org — the session is shared.

### 2. Service keys (alternative)

Create an API key in the Console (or Go docs: "OpenCode Zen API key" — the same workspace `sk-…` key family works on both gateways) and store it in `~/.pi/agent/auth.json` under the matching provider id:

```json
{
  "opencode-console": { "type": "api_key", "key": "sk-…" },
  "opencode-go-console": { "type": "api_key", "key": "sk-…" }
}
```

Storing a service key replaces any device-code entry for that provider id (one credential per provider id). After editing, run `/reload` to refresh the provider. Service keys are static: they are never refreshed, so a rejected key (`401`) surfaces as a terminal error rather than a retry. With no credential stored, the `$OPENCODE_API_KEY` environment variable is used as a fallback — the same env var upstream and pi's built-in providers use.

Model catalogs by credential:

| Credential | OpenCode Console (`opencode-console`) | OpenCode Go (`opencode-go-console`) |
| --- | --- | --- |
| Device session | org-scoped `GET {server}/api/config` with `Authorization: Bearer` + `x-org-id` | public `GET https://opencode.ai/zen/go/v1/models` (`lite` list) |
| Service key | public `GET https://opencode.ai/zen/v1/models` (workspace-scoped filtering when a real key is sent) | public `GET https://opencode.ai/zen/go/v1/models` (`lite` list) |

### 3. Manage

Run the provider commands to manage credentials:

```
/opencode-console status       # default; shows auth method, account, org, token expiry
/opencode-console refresh      # re-pull the catalog (org-scoped or public per credential)
/opencode-console switch-org   # device sessions only; re-pick the org
/opencode-console logout       # clear the credential

/opencode-go-console status    # auth method + account + org
/opencode-go-console refresh   # re-pull the public Go catalog
/opencode-go-console logout    # clear the Go credential; Console session preserved
```

## Configuration

| Env var | Default | Notes |
| --- | --- | --- |
| `OPENCODE_CONSOLE_SERVER` | `https://opencode.ai/console` | Override for self-hosted consoles. Persisted to `auth.json` on first sign-in. |

## Why separate providers?

The built-in `opencode` and `opencode-go` providers in Pi handle API-key-only access with static model lists. This extension deliberately registers distinct ids (`opencode-console`, `opencode-go-console`) so the built-ins stay untouched, while adding the device-flow session, live catalogs, and org awareness that the built-ins do not have — mirroring the behavior of the sister project (`opencode-copilot-chat`).

## Architecture

```
pi extension entry (src/index.ts)
  ├─ registerProvider("opencode-console", { apiKey, oauth, refreshModels, streamSimple })
  │    ├─ apiKey: "$OPENCODE_API_KEY"  → pi's api_key credential resolution (service keys)
  │    ├─ oauth.login      → shared device-code flow + org picker → auth.json[providerId]
  │    ├─ oauth.refreshToken → canonical refresh + sibling mirror (shared session)
  │    ├─ refreshModels    → /api/config (session) | public /models (service key)
  │    └─ streamSimple     → streamConsoleWithSession (per-credential loader)
  ├─ registerProvider("opencode-go-console", { apiKey, oauth, refreshModels, streamSimple })
  │    ├─ refreshModels    → public /models on the Go gateway (lite list)
  │    └─ streamSimple     → streamConsoleWithSession (Go entry, Console-entry fallback)
  └─ registerCommand for both providers
       streamConsole → delegates to pi-ai's lazy APIs
            ├─ anthropicMessagesApi
            ├─ openAICompletionsApi
            ├─ openAIResponsesApi
            └─ googleGenerativeAIApi
```

Upstream parity research and adopted-behavior citations live in [`docs/opencode-auth-parity.md`](docs/opencode-auth-parity.md).

URL routing is normalized per API kind in `src/endpoint.ts` so each SDK's URL composition produces the right endpoint:

| API kind | baseUrl normalization |
| --- | --- |
| `anthropic-messages` | strip trailing `/v1` (Anthropic SDK appends `/v1/messages`) |
| `openai-completions` | keep `/v1` (SDK appends `/chat/completions`) |
| `openai-responses` | keep `/v1` (SDK appends `/responses`) |
| `google-generative-ai` | keep `/v1beta` (Google SDK appends `/models/<id>:streamGenerateContent`) |

Identity headers (`x-opencode-org-id`, `x-opencode-client`, `x-opencode-request`) are injected per request in `streamConsole`.

## Development

```sh
npm install
npm run check
npm run package
```

## Project

- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Release process](RELEASING.md)

## License

MIT
