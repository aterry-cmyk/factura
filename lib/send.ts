// Email through Resend and text messages through Twilio, both over their REST APIs (no SDKs).
// Nothing is faked: without keys, the app says "setup needed" and never pretends it sent.

export const emailConfigured = (): boolean => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
export const smsConfigured = (): boolean =>
  Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);

export type SendOutcome = { ok: true; id: string } | { ok: false; detail: string };

export async function sendEmail(msg: {
  to: string;
  replyTo?: string;
  fromName: string;
  subject: string;
  html: string;
  text: string;
  attachment?: { filename: string; content: Uint8Array };
}): Promise<SendOutcome> {
  const from = process.env.EMAIL_FROM!;
  // Show the business's name but send from the verified address.
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  const res = await fetch(`${process.env.RESEND_API_URL || "https://api.resend.com"}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${msg.fromName.replace(/[<>"]/g, "")} <${address}>`,
      to: [msg.to],
      reply_to: msg.replyTo || undefined,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      attachments: msg.attachment
        ? [{ filename: msg.attachment.filename, content: Buffer.from(msg.attachment.content).toString("base64") }]
        : undefined,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) return { ok: false, detail: `Resend ${res.status}: ${body.message ?? "error"}` };
  return { ok: true, id: body.id ?? "" };
}

export async function sendSms(to: string, body: string): Promise<SendOutcome> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const base = process.env.TWILIO_API_URL || "https://api.twilio.com";
  const res = await fetch(`${base}/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: body }),
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!res.ok) return { ok: false, detail: `Twilio ${res.status}: ${json.message ?? "error"}` };
  return { ok: true, id: json.sid ?? "" };
}
