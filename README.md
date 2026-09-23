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
