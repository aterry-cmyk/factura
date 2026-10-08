import type { Metadata } from "next";
import Link from "next/link";
import { SetupWizard } from "@/components/SetupWizard";
import { pageCtx } from "@/lib/session";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bienvenido" };

/** The setup questions. New accounts land here; anyone can come back to change the answers. */
export default async function WelcomePage() {
  const ctx = await pageCtx();
  const settings = await getSettings(ctx.accountId);
  return (
    <main className="wrap setup-wrap">
      <div className="top">
        <Link href="/" className="brand" aria-label="Loro AI">
          <img src="/brand/loro-icon.svg" alt="" width={34} height={34} /> Loro AI
        </Link>
      </div>
      <SetupWizard defaults={settings} ownerName={ctx.name} hadLogo={settings.hasLogo} />
    </main>
  );
}
