import { Header } from "@/components/Header";
import { ProjectPlanner, type PlannerEstimate } from "@/components/ProjectPlanner";
import { aiConfigured } from "@/lib/ai/config";
import { headerUser, pageCtx } from "@/lib/session";
import { getDocument, getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

/** A new project, from an accepted estimate (?from=<id>) or from scratch. */
export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const ctx = await pageCtx();
  const [settings, doc] = await Promise.all([getSettings(ctx.accountId), from ? getDocument(ctx.accountId, from) : null]);
  const lang = settings.lang;
  const es = lang === "es";
  const estimate: PlannerEstimate | null = doc && doc.kind === "estimate"
    ? { id: doc.id, number: doc.number, customer: doc.customer, totalCents: doc.totalCents, summary: doc.items[0]?.description.slice(0, 160) ?? doc.number }
    : null;
  return (
    <main className="wrap">
      <Header lang={lang} user={headerUser(ctx)} />
      <h1 style={{ marginTop: 0 }}>{es ? "Nuevo proyecto" : "New project"}</h1>
      <ProjectPlanner lang={lang} estimate={estimate} aiReady={aiConfigured()} />
    </main>
  );
}
