# Factura — rules

A voice-first invoice and estimate tool for one owner. Keep it simple: one user, no multi-tenancy.

- **No fake functionality.** Without provider keys, show "setup needed"; never claim something was sent.
- **The AI proposes, the owner decides.** Prices he said are used exactly; past prices come from his history; anything else is a *suggested* price he must confirm (`validateDraft` refuses unconfirmed ones). `checkParsed` re-checks every "said"/"catalog" price and quantity against the transcript and catalog.
- **Structured output only**: the `record_request` tool, validated, one retry with the errors, then fail clearly. Prompts are versioned in `lib/ai/prompts/`; the model id lives only in `lib/ai/config.ts`; model + prompt version are saved on each document.
- **Money is whole cents, computed on the server** (`lib/money.ts`). Never trust totals from the browser.
- **Never give legal or tax advice.** The owner enters his own tax rate; late-fee screens carry the "check your state's limits" caution.
- Next.js 16: `proxy.ts` (not middleware), async `params`/`cookies`. Read `node_modules/next/dist/docs/` before using an API.
- Schema in `db/schema.sql`, idempotent; RLS on with no policies (the app talks to Postgres directly from the server).
- Raw errors go to the log / document history, never to the browser.
- Every change ships with tests: unit for logic, the DB suite for storage/sending, Playwright for the flow. Run `npm run check` before pushing.
