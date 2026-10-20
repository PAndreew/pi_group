/*
 * Schedules of scheduled jobs, in the server's local time: five-field cron ("30 7 * * 1-5"),
 * the shortcuts @hourly, @daily, @weekly and @monthly, or "@every 30m" (m, h or d).
 */

/** Nothing runs more often than this, so a job cannot hammer a service or the agent. */
export const MIN_INTERVAL_MS = 5 * 60_000;

const SHORTCUTS: Record<string, string> = { "@hourly": "0 * * * *", "@daily": "0 0 * * *", "@weekly": "0 0 * * 0", "@monthly": "0 0 1 * *" };
const RANGES = [
	[0, 59],
	[0, 23],
	[1, 31],
	[1, 12],
	[0, 7],
] as const;

type Cron = { minute: Set<number>; hour: Set<number>; day: Set<number>; month: Set<number>; weekday: Set<number>; anyDay: boolean; anyWeekday: boolean };
type Parsed = { every: number } | Cron;

function field(text: string, [min, max]: readonly [number, number]) {
	const values = new Set<number>();
	for (const part of text.split(",")) {
		const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
		if (!match) throw new Error(`Cannot read “${part}”`);
		const step = match[4] ? Number(match[4]) : 1;
		const from = match[1] === "*" ? min : Number(match[2]);
		const to = match[1] === "*" ? max : match[3] ? Number(match[3]) : match[4] ? max : from;
		if (step < 1 || from < min || to > max || from > to) throw new Error(`“${part}” is out of range ${min}-${max}`);
		for (let v = from; v <= to; v += step) values.add(v);
	}
	return values;
}

function parse(schedule: string): Parsed {
	const text = schedule.trim().toLowerCase();
	const every = /^@every\s+(\d+)\s*([mhd])$/.exec(text);
	if (every) return { every: Number(every[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[every[2] as "m" | "h" | "d"] };
	const parts = (SHORTCUTS[text] ?? text).split(/\s+/);
	if (parts.length !== 5) throw new Error("Use five cron fields (minute hour day month weekday), @hourly, @daily, @weekly, @monthly or @every 30m");
	const [minute, hour, day, month, weekday] = parts.map((p, i) => field(p, RANGES[i]));
	if (weekday.delete(7)) weekday.add(0);
	return { minute, hour, day, month, weekday, anyDay: parts[2] === "*", anyWeekday: parts[4] === "*" };
}

function nextCron(cron: Cron, after: Date) {
	const t = new Date(after);
	t.setSeconds(0, 0);
	t.setMinutes(t.getMinutes() + 1);
	// Classic cron: with both day of month and weekday restricted, either one matching is enough.
	const dayMatches = () => {
		const day = cron.day.has(t.getDate());
		const weekday = cron.weekday.has(t.getDay());
		if (cron.anyDay) return weekday;
		if (cron.anyWeekday) return day;
		return day || weekday;
	};
	const limit = after.getTime() + 5 * 366 * 86_400_000;
	while (t.getTime() < limit) {
		if (!cron.month.has(t.getMonth() + 1)) {
			t.setMonth(t.getMonth() + 1, 1);
			t.setHours(0, 0);
		} else if (!dayMatches()) {
			t.setDate(t.getDate() + 1);
			t.setHours(0, 0);
		} else if (!cron.hour.has(t.getHours())) {
			t.setHours(t.getHours() + 1, 0);
		} else if (!cron.minute.has(t.getMinutes())) {
			t.setMinutes(t.getMinutes() + 1);
		} else return t;
	}
	return undefined;
}

/** When a schedule fires next after `after`; undefined if it never does (e.g. 30 February). */
export function nextRun(schedule: string, after: Date): Date | undefined {
	const parsed = parse(schedule);
	return "every" in parsed ? new Date(after.getTime() + parsed.every) : nextCron(parsed, after);
}

/** Throws a readable error for a schedule that cannot be read, never fires, or fires more often than every 5 minutes. */
export function checkSchedule(schedule: string) {
	const parsed = parse(schedule);
	if ("every" in parsed) {
		if (parsed.every < MIN_INTERVAL_MS) throw new Error("Jobs can run at most every 5 minutes");
		return;
	}
	let at = nextCron(parsed, new Date());
	if (!at) throw new Error("This schedule never fires");
	// A year of runs is enough to find the closest pair for any cron pattern.
	for (let i = 0; i < 400 && at; i++) {
		const next = nextCron(parsed, at);
		if (next && next.getTime() - at.getTime() < MIN_INTERVAL_MS) throw new Error("Jobs can run at most every 5 minutes");
		at = next;
	}
}
