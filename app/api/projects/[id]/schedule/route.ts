import { fail, readJson } from "@/lib/http";
import { getProject, saveSchedule } from "@/lib/projects-store";
import { layoutSchedule, validateSchedule } from "@/lib/schedule";
import { routeCtx } from "@/lib/session";

/** The start date and each milestone's days; the app lays the dates end to end. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await routeCtx();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const checked = validateSchedule(await readJson(req));
  if (!checked.ok) return Response.json({ error: "invalid", errors: checked.errors }, { status: 400 });
  const view = await getProject(ctx.accountId, id);
  if (!view) return fail("not_found", 404);
  const days = new Map(checked.value.milestones.map((m) => [m.id, m.days]));
  const dated = layoutSchedule(view.milestones.map((m) => ({ id: m.id, position: m.position, days: days.get(m.id) ?? m.days })), checked.value.startsOn);
  await saveSchedule(ctx.accountId, id, checked.value.startsOn, dated);
  return Response.json({ ok: true, milestones: dated.map((m) => ({ id: m.id, days: m.days, startsOn: m.startsOn, endsOn: m.endsOn })) });
}
