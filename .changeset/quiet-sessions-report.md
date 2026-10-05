---
"pi-provider-opencode-console": patch
---

Send the `x-opencode-session` header the Go surface requires, use the raw upstream model id instead of the duplicate-disambiguated pi id, so console-catalog models such as `opencode-go/deepseek-v4.1-flash` no longer fail with `MissingSessionID` or `Model is unavailable`, and serve the persisted catalog for pi's cache-only startup refresh so the provider's models are available on startup and in `-p` mode instead of being cleared.
