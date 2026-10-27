import { redirect } from "next/navigation";
import { Estimator } from "@/components/Estimator";
import { Header } from "@/components/Header";
import { MODEL, aiConfigured } from "@/lib/ai/config";
import { azureConfigured } from "@/lib/azure-speech";
import { falConfigured } from "@/lib/estimator/images";
import { headerUser, pageCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function EstimatorPage() {
  const ctx = await pageCtx();
  const settings = await getSettings(ctx.accountId);
  if (!settings.onboarded) redirect("/welcome");
  return (
    <main className="wrap">
      <Header lang={settings.lang} user={headerUser(ctx)} />
      <Estimator lang={settings.lang} defaults={settings} ai={aiConfigured()} images={falConfigured()} cloudVoice={azureConfigured()} model={MODEL} />
    </main>
  );
}
