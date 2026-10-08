import { Header } from "@/components/Header";
import { SettingsForm } from "@/components/SettingsForm";
import { VoiceSettings } from "@/components/VoiceSettings";
import { aiConfigured } from "@/lib/ai/config";
import { azureConfigured } from "@/lib/azure-speech";
import { dict } from "@/lib/i18n";
import { emailConfigured, smsConfigured } from "@/lib/send";
import { getSettings } from "@/lib/store";
import { headerUser, pageCtx } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await pageCtx();
  const s = await getSettings(ctx.accountId);
  const t = dict(s.lang);
  const connections: [string, boolean, string][] = [
    ["Asistente / Assistant (Anthropic)", aiConfigured(), "ANTHROPIC_API_KEY"],
    ["Email (Resend)", emailConfigured(), "RESEND_API_KEY, EMAIL_FROM"],
    ["SMS (Twilio)", smsConfigured(), "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM"],
    [s.lang === "es" ? "Voz natural (Azure Speech)" : "Natural voice (Azure Speech)", azureConfigured(), "AZURE_SPEECH_KEY, AZURE_SPEECH_REGION"],
    [s.lang === "es" ? "Recordatorios automáticos" : "Automatic reminders", Boolean(process.env.CRON_SECRET), "CRON_SECRET"],
  ];
  return (
    <main className="wrap">
      <Header lang={s.lang} user={headerUser(ctx)} />
      <h1>{t.settings}</h1>
      <SettingsForm
        lang={s.lang}
        hasLogo={s.hasLogo}
        business={{ name: s.name, ownerName: s.ownerName, address: s.address, phone: s.phone, email: s.email, website: s.website }}
      />
      <VoiceSettings lang={s.lang} country={s.country} voiceOn={s.voiceOn} voiceGender={s.voiceGender} cloud={azureConfigured()} />
      {!ctx.isAdmin && (
        <section className="card">
          <h3>{t.connections}</h3>
          <ul className="list">
            {connections.slice(1, 3).map(([name, ok]) => (
              <li key={name} className="row" style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
                <div className="grow" style={{ fontWeight: 600 }}>{name}</div>
                <span className={`badge ${ok ? "" : "grey"}`}>{ok ? t.connected : t.comingSoon}</span>
              </li>
            ))}
          </ul>
          <p className="muted small" style={{ marginBottom: 0 }}>{t.shareMeanwhile}</p>
        </section>
      )}
      {ctx.isAdmin && (
      <section className="card">
        <h3>{t.connections} · Admin</h3>
        <ul className="list">
          {connections.map(([name, ok, keys]) => (
            <li key={name} className="row" style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{name}</div>
                {!ok && <div className="muted small">{keys}</div>}
              </div>
              <span className={`badge ${ok ? "" : "warn"}`}>{ok ? t.connected : t.notConnected}</span>
            </li>
          ))}
        </ul>
      </section>
      )}
    </main>
  );
}
