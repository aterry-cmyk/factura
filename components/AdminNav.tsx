import Link from "next/link";
import type { Lang } from "@/lib/types";

export function AdminNav({ lang, current }: { lang: Lang; current: "accounts" | "waitlist" }) {
  const es = lang === "es";
  return (
    <nav className="chips" aria-label="Admin" style={{ margin: "4px 0 16px" }}>
      <Link href="/admin" className="chip" aria-pressed={current === "accounts"}>{es ? "Cuentas y cobros" : "Accounts and billing"}</Link>
      <Link href="/admin/waitlist" className="chip" aria-pressed={current === "waitlist"}>{es ? "Lista de espera" : "Waitlist"}</Link>
    </nav>
  );
}
