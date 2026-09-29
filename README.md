# Antigravity AI Provider 🚀✨

Your high-performance, multi-key load-balanced custom OpenAI-compatible proxy for Google Gemini models, deployed effortlessly on Vercel Edge Runtime!

---

## 🌟 Features

* **Multi-Key Load Balancing & Failover:** Automatically cycles through up to 100 environment keys (`Key_1` to `Key_100` plus `GEMINI_KEYS_POOL`) with instant retry logic on rate limits (`429`) or server restrictions (`403`).
* **Edge Runtime Powered:** Built on Vercel's lightning-fast Edge functions for ultra-low latency worldwide.
* **Dynamic Model Aggregation:** Automatically pools quotas across all active working keys to give you amplified RPM/TPM/RPD limits.
* **OpenAI API Compatibility:** Drop-in replacement endpoint (`/v1/chat/completions`) ready for any standard OpenAI client or UI interface!

---

## ⚙️ Environment Variables Configuration

Set these up in your Vercel Project Settings under **Environment Variables**:

1. **Individual Keys:** `Key_1`, `Key_2`, ..., `Key_100` containing your Google AI Studio Gemini API keys.
2. **Pooled Keys (Optional):** `GEMINI_KEYS_POOL` containing a comma-separated list of additional API keys.

---

## 🔌 API Endpoints

* **Chat Completions:** `https://antigravity-seven-delta.vercel.app/v1/chat/completions`
* **Models List:** `https://antigravity-seven-delta.vercel.app/api/models`
* 
## Router behavior contract

This gateway is a fan-out proxy over multiple upstream pools. To keep it
debuggable, it adheres to the following rules:

- **No fake 200s.** If every upstream fails, the gateway returns HTTP 502
  with an `error.type` of `all_upstreams_failed` and the list of attempts
  in `error.attempts`. It never synthesizes a completion.
- **No silent model substitution.** When a request falls back to a target
  that must change the `model` field (currently only the Gemini fallback
  for non-Gemini models), the response includes:
  - `X-Antigravity-Target: <provider>`
  - `X-Antigravity-Requested-Model: <original>`
  - `X-Antigravity-Model-Rewritten: true`
- **Attempt tracing.** Whenever any target fails before a successful one,
  the response carries `X-Antigravity-Attempts` with a compact
  `provider:outcome` list (e.g. `unorouter:timeout,atria:http_error`).
- **Honest diagnostics.** `GET /v1/models` reports a `live` boolean and a
  `status` string per provider. `static_table_only` means the models are
  published from a hardcoded table and were *not* verified against the
  upstream at request time.

### Probing for dishonesty

`scripts/honesty-probe.sh` sends a unique sentinel token to each model and
reports:

| Verdict          | Meaning                                                      |
|------------------|--------------------------------------------------------------|
| `OK`             | Model matched request and echoed the sentinel                 |
| `SUBSTITUTED`    | Returned model differs from requested                         |
| `NO_SENTINEL`    | Model answered but didn't echo the sentinel (possible proxy drift) |
| `CANNED_FALLBACK`| Response matches a known synthesized message                  |
| `PARSE_FAIL`     | Non-JSON response (usually a platform timeout page)           |

Run locally:
```sh
npm install
node server.js
./scripts/honesty-probe.sh http://localhost:3000

