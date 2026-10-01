# Factura

Invoices and estimates by voice, for one small business owner. He says what he needs, in Spanish or English (*"Necesito una factura para Juan: pintar la cocina, $2,200, y materiales, $350"*). The assistant turns that into line items and suggests prices for anything he didn't price. A short step-by-step form in his language asks the rest (customer, business name, state and tax, when it's due, reminders, late fee, how to get paid). The app then makes the invoice, shows it, and asks whether it's ready to send by email or text.

One sign-in. No accounting, no payment processing. It shows his payment instructions and he marks invoices paid himself.

## How it works

| Step | Where |
|---|---|
| Voice → text | The browser's own dictation (Chrome, Edge, Safari) in the owner's country's Spanish (`es-MX`, `es-PR`, `es-CO`…; falls back to `es-US` where a browser doesn't know it), or `en-US`. Typing works everywhere. |
| Text → voice | Settings → Voz: he picks his country (`lib/voice.ts`). The device's own voice reads back what was understood (amounts from the items on screen) and each question (`components/useVoice.ts`). It prefers that country's voice, then another natural Spanish voice, never the toy ones, and Settings says plainly when the device has no voice for his country. Can be switched off. A speech failure never blocks the flow. |
| Natural voice (optional) | With `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION`, `/api/speak` reads the text in Azure's neural voice for his country (a woman's or a man's, his choice in Settings; names in `lib/voice.ts`), the same on every phone. The voice comes from his saved settings, never the browser. If Azure fails, the device's voice says it instead. |
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

## Setup (Supabase + Vercel)

**1. Supabase**
- Create a project (any region near the client). Save the database password.
- Create the tables, either way:
  - SQL Editor → paste `supabase/migrations/20261001000000_init.sql` → Run; or
  - `npx supabase link --project-ref <ref>` then `npx supabase db push`.
- Copy the connection string: **Connect → Transaction pooler** (port `6543`). That's `DATABASE_URL`. The app turns off prepared statements on that port automatically, which the pooler requires.
- Nothing else in Supabase is used: no Supabase Auth, no Storage (the logo is kept in the database). RLS is on with no policies, so the public API can't read the tables.

**2. Vercel**
- Import the repo (framework: Next.js, no build settings to change).
- Environment variables (Production):

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Supabase transaction-pooler string |
| `OWNER_PASSWORD` | the client's password |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | from console.anthropic.com |
| `APP_URL` | the final address, e.g. `https://facturas.example.com` (printed in links customers get) |
| `CRON_SECRET` | `openssl rand -hex 32` (Vercel sends it to the reminder job) |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional, email |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | optional, natural voice per country (a Speech resource in Azure; region like `eastus`) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | optional, SMS |

- Deploy. `vercel.json` schedules `/api/cron/reminders` daily at 15:00 UTC (once a day works on the Hobby plan too).
- Sign in at the address, open **Ajustes**: Connections shows what's connected; add the logo there.

**3. Email (Resend)**: add and verify the client's domain (DNS records), then set `EMAIL_FROM` like `Pintura Hernández <facturas@sudominio.com>`. Replies go to the business email he enters in the form.

**4. SMS (Twilio)**: buy a US number, register A2P 10DLC (sole-proprietor registration is the quick path; it takes days), then set the three variables.

**Local development**: `cp .env.example .env.local`, fill in `DATABASE_URL` (Supabase or a local Postgres), `npm install`, `npm run db:migrate`, `npm run dev`.

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
