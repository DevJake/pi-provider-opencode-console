---
"pi-provider-opencode-console": patch
---

Port the sister bridge's catalog fixes and metadata parity ahead of the v1.0.0 bump:

- Route model families the way the gateways actually behave even when models.dev omits a package name: Grok and Muse Spark ids route to Responses, Qwen ids to Messages, Go MiniMax ids to Messages, and Console Gemini ids to Google.
- Filter internal `test*` smoke-test ids that leak into authenticated discovery instead of listing them as unenriched entries.
- Enrich discovery-only ids that models.dev has not cataloged yet with mirrored sibling metadata (Console: `jev-1.13`, `jev-1.13-free`; Go: `deepseek-flash`, `minimax-m2.5`, `kimi-k2.5`, `glm-5.1`, `glm-5`, `qwen3.5-plus`, `mimo-v2-pro`, `mimo-v2-omni`, `omen-alpha`, `hy3-preview`); canonical upstream entries supersede the mirrors automatically once they land.
- Hide the legacy alias id (`deepseek-flash` → `deepseek-v4.1-flash`) when both are served in one discovery response; alias-only discovery keeps its mirrored metadata.
- Map `reasoning_options` effort values onto pi's thinking levels (unsupported levels are explicitly `null` so pi's clamping picks a supported effort instead of sending one the gateway rejects); toggle/budget-only models are unmapped.
- Cache the models.dev snapshot in-process with a 6h TTL and a 15s timeout instead of refetching the full catalog on every model refresh, keeping provider-level `npm` routing inheritance.