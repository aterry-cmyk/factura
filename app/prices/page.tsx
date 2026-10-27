import { Header } from "@/components/Header";
import { PriceSearch } from "@/components/PriceSearch";
import { aiConfigured } from "@/lib/ai/config";
import { recentLookups } from "@/lib/costs-store";
import { headerUser, pageCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function PricesPage() {
  const ctx = await pageCtx();
  const [settings, recent] = await Promise.all([getSettings(ctx.accountId), recentLookups(ctx.accountId)]);
  const es = settings.lang === "es";
  return (
    <main className="wrap">
      <Header lang={settings.lang} user={headerUser(ctx)} />
      <h1 style={{ marginTop: 0 }}>{es ? "Precios de materiales" : "Material prices"}</h1>
      <p className="muted">{es ? "Primero lo que tú has pagado (de tus recibos), luego lo que hay en línea hoy, con la página de donde salió cada precio." : "First what you have paid (from your receipts), then what's online today, with the page each price came from."}</p>
      <PriceSearch lang={settings.lang} aiReady={aiConfigured()} recent={recent} />
    </main>
  );
}
