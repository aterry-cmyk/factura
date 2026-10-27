import Link from "next/link";
import { CrewSettings } from "@/components/CrewSettings";
import { Header } from "@/components/Header";
import { getBurden, listWorkers } from "@/lib/costs-store";
import { headerUser, pageCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function CrewPage() {
  const ctx = await pageCtx();
  const [settings, workers, burden] = await Promise.all([getSettings(ctx.accountId), listWorkers(ctx.accountId), getBurden(ctx.accountId)]);
  const es = settings.lang === "es";
  return (
    <main className="wrap">
      <Header lang={settings.lang} user={headerUser(ctx)} />
      <p className="small" style={{ margin: "0 0 6px" }}><Link href="/settings">← {es ? "Ajustes" : "Settings"}</Link></p>
      <h1 style={{ marginTop: 0 }}>{es ? "Cuadrilla y salarios" : "Crew and wages"}</h1>
      <p className="muted">{es ? "Con esto, «hoy trabajaron Pedro y Luis 8 horas» se vuelve un costo de mano de obra con el salario real de cada uno." : "With this, “Pedro and Luis worked 8 hours today” becomes a labor cost at each one's true wage."}</p>
      <CrewSettings lang={settings.lang} workers={workers} burden={burden} />
    </main>
  );
}
