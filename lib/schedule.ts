import { addDays, daysBetween } from "./money";

// A project's schedule: milestones laid end to end from the start date, each with its days.
// Working days are not modelled yet: a day is a calendar day, which is what customers are told.

export interface Scheduled {
  id: string;
  position: number;
  days: number | null;
  startsOn: string | null;
  endsOn: string | null;
}

export const DEFAULT_DAYS = 5;

/** Lays the milestones end to end from the start date, keeping each one's days (or the default). */
export function layoutSchedule<M extends Pick<Scheduled, "id" | "position" | "days">>(milestones: M[], startsOn: string): (M & { startsOn: string; endsOn: string; days: number })[] {
  let cursor = startsOn;
  return [...milestones].sort((a, b) => a.position - b.position).map((m) => {
    const days = m.days && m.days > 0 ? m.days : DEFAULT_DAYS;
    const s = cursor;
    const e = addDays(s, days - 1);
    cursor = addDays(e, 1);
    return { ...m, days, startsOn: s, endsOn: e };
  });
}

/** When the job ends, and how many calendar days it takes, given every milestone has dates. */
export function scheduleSpan(milestones: Pick<Scheduled, "startsOn" | "endsOn">[]): { startsOn: string; endsOn: string; days: number } | null {
  const dated = milestones.filter((m) => m.startsOn && m.endsOn) as { startsOn: string; endsOn: string }[];
  if (!dated.length) return null;
  const startsOn = dated.map((m) => m.startsOn).sort()[0];
  const endsOn = dated.map((m) => m.endsOn).sort().at(-1)!;
  return { startsOn, endsOn, days: daysBetween(startsOn, endsOn) + 1 };
}

/** How far the calendar says the job should be, against how far the work actually is. */
export function scheduleStatus(span: { startsOn: string; endsOn: string }, today: string, percentDone: number): { expectedPercent: number; behind: boolean; daysLeft: number } {
  const total = Math.max(1, daysBetween(span.startsOn, span.endsOn) + 1);
  const elapsed = Math.min(total, Math.max(0, daysBetween(span.startsOn, today) + 1));
  const expectedPercent = Math.round((elapsed / total) * 100);
  return { expectedPercent, behind: percentDone + 10 < expectedPercent, daysLeft: Math.max(0, daysBetween(today, span.endsOn)) };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface ScheduleInput {
  startsOn: string;
  milestones: { id: string; days: number }[];
}

export function validateSchedule(raw: unknown): Result<ScheduleInput> {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const errors: string[] = [];
  const startsOn = typeof r.startsOn === "string" && DAY.test(r.startsOn) ? r.startsOn : "";
  if (!startsOn) errors.push("startsOn: Pick a start date.");
  const milestones = (Array.isArray(r.milestones) ? r.milestones : []).slice(0, 99).flatMap((m) => {
    const x = m && typeof m === "object" ? (m as Record<string, unknown>) : {};
    const id = typeof x.id === "string" && /^[0-9a-f-]{36}$/i.test(x.id) ? x.id : "";
    const days = Number(x.days);
    if (!id) return [];
    if (!(Number.isInteger(days) && days >= 1 && days <= 365)) {
      errors.push(`milestones: Days must be between 1 and 365.`);
      return [];
    }
    return [{ id, days }];
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: { startsOn, milestones } };
}
