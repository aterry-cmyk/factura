import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

// One connection pool per server instance, kept on globalThis so dev reloads don't open new ones.
const holder = globalThis as unknown as { __facturaSql?: Sql };

export function sql(): Sql {
  if (!holder.__facturaSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    holder.__facturaSql = postgres(url, {
      max: 5,
      idle_timeout: 20,
      // Supabase's transaction pooler (port 6543) doesn't support prepared statements.
      prepare: !url.includes(":6543"),
      onnotice: () => {},
    });
  }
  return holder.__facturaSql;
}
