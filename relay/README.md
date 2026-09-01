# FASTRACK Managed Relay

An OpenAI-compatible proxy to Groq deployed on Vercel. Lets FASTRACK users run with **no model provider account of their own** — they just use the relay URL as a `custom` provider with a client token.

## How it works

- `POST /v1/chat/completions` — OpenAI-compatible passthrough to Groq
- Auth: the client's `Authorization: Bearer <token>` must be listed in the relay's `CLIENT_TOKENS`
- Model allowlist + `max_tokens` cap protect the server-side key from abuse
- Best-effort per-token rate limit (30 req/min)

Because FASTRACK's `custom` provider already sends `Authorization: Bearer <key>`, the relay needs zero client-side changes.

## Deploy (owner)

```bash
npm i -g vercel
vercel login                      # browser flow, one time
cd relay
vercel --prod                     # first deploy: pick a project name (e.g. fastrack-relay)

# set env vars (repeat for each; paste value when prompted; choose production)
vercel env add GROQ_API_KEY production
vercel env add CLIENT_TOKENS production    # comma-separated client tokens, e.g. ft_user1,ft_user2
vercel --prod                     # redeploy so env vars take effect
```

## Onboard a user (owner)

1. Add their token to `CLIENT_TOKENS` and redeploy
2. Tell them:

```bash
fastrack model add
# provider: custom
# base URL: https://<your-project>.vercel.app/v1
# API key:  <their client token>
# model:    openai/gpt-oss-120b
```

## Honest limits (free hosting)

- In-memory throttle resets on serverless cold starts — it caps bursts, not a billing-grade quota
- Hobby plan: no SLA, cold starts possible
- For production, move the throttle to Vercel KV/Upstash and add per-user budgets
