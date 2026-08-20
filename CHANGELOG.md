# Changelog

## 0.1.0

- Add an OpenCode Console provider for Pi using the OAuth 2.0 device authorization grant.
- Discover account-specific models from the org-scoped `/api/config` endpoint.
- Route chat requests to the right upstream wire API per-model (`anthropic-messages`, `openai-completions`, `openai-responses`, `google-generative-ai`), delegating streaming and parsing to pi-ai's built-in implementations.
- Auto-refresh the OAuth access token when within 5 minutes of expiry, single-flight.
- Add `/opencode-console` for `status`, `refresh`, `switch-org`, and `logout`.
- Add tests, package metadata, Changesets, CI, and npm trusted publishing.
