# Factura

Invoices and estimates by voice, for one small business owner. He says what he needs, in Spanish or English (*"Necesito una factura para Juan: pintar la cocina, $2,200, y materiales, $350"*). The assistant turns that into line items and suggests prices for anything he didn't price. A short step-by-step form in his language asks the rest (customer, business name, state and tax, when it's due, reminders, late fee, how to get paid). The app then makes the invoice, shows it, and asks whether it's ready to send by email or text.

One sign-in. No accounting, no payment processing. It shows his payment instructions and he marks invoices paid himself.

## How it works

| Step | Where |
|---|---|
| Voice → text | The browser's own dictation (Chrome, Edge, Safari; `es-US` / `en-US`). Typing works everywhere. |
| Text → items | Claude with one tool, `record_request` (`lib/ai/parse.ts`, prompt `lib/ai/prompts/parse-request.ts`). |
| Estimator | A price he said is used as said. A job he's priced before uses his past price. Anything else gets a **suggested** price with a one-line reason, and he has to confirm or change it before he can continue. |
| Checks on the AI | A price marked "said" must appear in what was heard; a "past price" must be in his history; a quantity must have been said. If not, it becomes a suggestion to confirm. One retry with the exact problems, then a clear failure. Model and prompt version are saved on each document. |
| Questions | `components/Creator.tsx`: customer → your business → state + tax → due date + reminders → late fee → how to get paid (+ document language, notes). Answers are remembered for next time. |
| Totals | Server-side, whole cents (`lib/money.ts`). Late fees: flat once, or % per started month after the grace days, capped at 12 months. |
| PDF | `lib/pdf.ts` (pdf-lib, Letter, logo, multi-page). |
| Send | Email with the PDF attached via Resend; text with a link via Twilio (`lib/send.ts`, `lib/deliver.ts`). Without keys the buttons say **setup needed**. Nothing is faked. Every attempt goes into the document's history with the provider's real answer. |
| Customer link | `/i/<token>`: the document and its PDF, no sign-in. Opens once the document is sent or its link is copied. |
| Reminders | `/api/cron/reminders`, daily through Vercel Cron. Starts on the due date, repeats every N days, stops when paid or after 6. Includes the late fee owed that day. |
| Estimates | Same flow; "Turn into invoice" copies it with today's saved terms. |

## Setup

1. **Database**: any Postgres. On Supabase, create a project and copy the connection string (Project Settings → Database). Then:
   ```bash
   cp .env.example .env.local   # fill it in
   npm install
   DATABASE_URL=... npm run db:migrate
   ```
2. **Sign-in**: set `OWNER_PASSWORD` and `SESSION_SECRET` (`openssl rand -hex 32`).
3. **Assistant**: `ANTHROPIC_API_KEY`. The model is set only in `lib/ai/config.ts` (override with `ANTHROPIC_MODEL`).
4. **Email (optional)**: verify a domain on [Resend](https://resend.com), then set `RESEND_API_KEY` and `EMAIL_FROM`. Replies go to the business email he enters.
5. **SMS (optional)**: on [Twilio](https://twilio.com), set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM`. US texting needs A2P 10DLC registration, which takes days, so start it early.
6. **Deploy** on Vercel, set the same variables plus `APP_URL` (the address printed in links) and `CRON_SECRET`. `vercel.json` runs reminders daily at 15:00 UTC.

Settings → Connections shows which of these are connected.

## Tests

```bash
npm run check                                   # types + unit tests + production build
TEST_DATABASE_URL=postgres://… npm test         # adds the database + sending tests (wipes that DB)
TEST_DATABASE_URL=postgres://… npm run test:e2e # browser tests: full Spanish flow, send, customer link, paid, estimate → invoice
```
The browser tests run the real app against `e2e/fake-services.mjs`, which stands in for Anthropic, Resend and Twilio through their base URLs. The app itself has no fake mode.

## Guía rápida (español)

1. Entra con tu contraseña.
2. Toca el micrófono y di lo que necesitas: *"Factura para Juan, pintar la cocina 2,200 y materiales 350"*. También puedes escribirlo.
3. Revisa los conceptos. Si la app sugirió un precio, confírmalo o cámbialo.
4. Contesta las preguntas: cliente, tu empresa, estado e impuestos, cuándo vence, recordatorios, recargo y cómo quieres que te paguen. La próxima vez ya estarán llenas.
5. Revisa la factura y envíala por correo o por mensaje, o copia el enlace y mándalo por WhatsApp.
6. Cuando te paguen, toca **Marcar pagada** y paran los recordatorios.
