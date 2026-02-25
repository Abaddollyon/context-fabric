/**
 * TimeService — timezone-aware time utilities using only the Node.js Intl API.
 * Provides time anchors, date resolution, formatting, and world-clock conversion.
 */

export interface TimeAnchor {
  epochMs: number;
  iso: string;           // "2026-02-25T14:30:00.000-05:00"
  timezone: string;      // "America/New_York"
  utcOffset: string;     // "-05:00"
  // Human
  timeOfDay: string;     // "2:30 PM"
  date: string;          // "Wednesday, February 25, 2026"
  dateShort: string;     // "Feb 25"
  dayOfWeek: string;     // "Wednesday"
  isWeekend: boolean;
  weekNumber: number;
  // Boundaries (epoch ms)
  startOfDay: number;
  endOfDay: number;
  startOfNextDay: number;
  startOfYesterday: number;
  startOfWeek: number;   // Monday
  endOfWeek: number;     // end of Sunday
  startOfNextWeek: number;
}

export interface TimeConversion {
  epochMs: number;
  timezone: string;
  iso: string;
  timeOfDay: string;
  date: string;
  utcOffset: string;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

interface DateParts {
  year: number;
  month: number;  // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;      // "Wednesday"
  weekdayShort: string; // "Wed"
}

function decomposeDateInTZ(epochMs: number, tz: string): DateParts {
  const fmtFull = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
    weekday: "long",
  });
  const fmtShort = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  });

  const parts = Object.fromEntries(
    fmtFull.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value])
  );
  const shortParts = Object.fromEntries(
    fmtShort.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value])
  );

  // hour12:false can return "24" for midnight — normalise
  const rawHour = parseInt(parts.hour, 10);
  return {
    year:         parseInt(parts.year, 10),
    month:        parseInt(parts.month, 10),
    day:          parseInt(parts.day, 10),
    hour:         rawHour === 24 ? 0 : rawHour,
    minute:       parseInt(parts.minute, 10),
    second:       parseInt(parts.second, 10),
    weekday:      parts.weekday,
    weekdayShort: shortParts.weekday,
  };
}

function startOfDayMs(epochMs: number, tz: string): number {
  // Step 1: find Y/M/D in target tz
  const { year, month, day } = decomposeDateInTZ(epochMs, tz);

  // Step 2: noon UTC for that calendar date (avoids DST boundary issues)
  const noonUtc = Date.UTC(year, month - 1, day, 12, 0, 0);

  // Step 3: find local H:M:S at noonUtc in target tz
  const { hour, minute, second } = decomposeDateInTZ(noonUtc, tz);

  // Step 4: subtract local time-of-noon from noon to get start of day
  let startOfDay = noonUtc - (hour * 3600 + minute * 60 + second) * 1000;

  // Step 5: verify — if the resulting day is wrong, adjust by ±1 day
  const check = decomposeDateInTZ(startOfDay, tz);
  if (check.day !== day) {
    const delta =
      check.day < day || check.month < month || check.year < year
        ? 86400000
        : -86400000;
    startOfDay += delta;
  }

  return startOfDay;
}

function isoWithOffset(epochMs: number, tz: string): string {
  const { year, month, day, hour, minute, second } = decomposeDateInTZ(epochMs, tz);

  // Compute UTC offset in minutes
  const localAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = Math.round((localAsUtcMs - epochMs) / 60000);

  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMinutes);
  const oh = String(Math.floor(absMin / 60)).padStart(2, "0");
  const om = String(absMin % 60).padStart(2, "0");

  const ms = String(Math.abs(epochMs % 1000)).padStart(3, "0");
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${year}-${pad(month)}-${pad(day)}` +
    `T${pad(hour)}:${pad(minute)}:${pad(second)}.${ms}` +
    `${sign}${oh}:${om}`
  );
}

function utcOffsetString(epochMs: number, tz: string): string {
  const { year, month, day, hour, minute, second } = decomposeDateInTZ(epochMs, tz);
  const localAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = Math.round((localAsUtcMs - epochMs) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMinutes);
  const oh = String(Math.floor(absMin / 60)).padStart(2, "0");
  const om = String(absMin % 60).padStart(2, "0");
  return `${sign}${oh}:${om}`;
}

function isoWeekNumber(epochMs: number, tz: string): number {
  const { year, month, day } = decomposeDateInTZ(epochMs, tz);
  // Find the Thursday of the ISO week containing this date
  const d = new Date(Date.UTC(year, month - 1, day));
  // ISO weekday: Mon=1 … Sun=7
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  // Move to Thursday of this week
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatTimeOfDay(epochMs: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(epochMs));
}

function formatDateLong(epochMs: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(epochMs));
}

function formatDateShort(epochMs: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
  }).format(new Date(epochMs));
}

// Day-of-week name -> ISO weekday index (Mon=1 … Sun=7)
const DOW_INDEX: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
  friday: 5, saturday: 6, sunday: 7,
};

// ─── TimeService ─────────────────────────────────────────────────────────────

/**
 * Timezone-aware time utilities using only the Node.js built-in Intl API.
 * Provides time anchors, conversions, natural-language date resolution,
 * and human-friendly formatting — all without external dependencies.
 */
export class TimeService {
  // ── Static helpers ──────────────────────────────────────────────────────

  /** Return the system's IANA timezone (e.g. "America/New_York"). */
  static systemTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  /** Check whether a string is a valid IANA timezone identifier. */
  static isValidTimezone(tz: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }

  // ── Core methods ────────────────────────────────────────────────────────

  /** Build a TimeAnchor for the current moment. */
  now(timezone?: string): TimeAnchor {
    const tz = timezone ?? TimeService.systemTimezone();
    const epochMs = Date.now();
    return this._buildAnchor(epochMs, tz);
  }

  /** Build a full TimeAnchor for an arbitrary epoch ms (not just "now"). */
  atTime(epochMs: number, timezone?: string): TimeAnchor {
    const tz = timezone ?? TimeService.systemTimezone();
    return this._buildAnchor(epochMs, tz);
  }

  /** Convert an epoch-ms timestamp into a specific timezone. */
  convert(epochMs: number, timezone: string): TimeConversion {
    return {
      epochMs,
      timezone,
      iso:       isoWithOffset(epochMs, timezone),
      timeOfDay: formatTimeOfDay(epochMs, timezone),
      date:      formatDateLong(epochMs, timezone),
      utcOffset: utcOffsetString(epochMs, timezone),
    };
  }

  /**
   * Resolve a natural-language date expression to epoch ms.
   * Supports: "now", "today", "yesterday", "tomorrow", "start/end of day",
   * "start/end of week", "next Monday" .. "last Sunday", ISO strings, and
   * bare epoch-ms numbers.
   */
  resolve(expression: string, timezone?: string): number {
    const tz    = timezone ?? TimeService.systemTimezone();
    const nowMs = Date.now();
    const expr  = expression.trim().toLowerCase();

    // Bare epoch ms (10+ digits)
    if (/^\d{10,}$/.test(expr)) {
      return parseInt(expr, 10);
    }

    switch (expr) {
      case "now":       return nowMs;
      case "today":     return startOfDayMs(nowMs, tz);
      case "yesterday": return startOfDayMs(nowMs - 86400000, tz);
      case "tomorrow":  return startOfDayMs(nowMs + 86400000, tz);
    }

    if (expr === "start of day")       return startOfDayMs(nowMs, tz);
    if (expr === "end of day")         return startOfDayMs(nowMs, tz) + 86400000 - 1;
    if (expr === "start of week")      return this._startOfWeek(nowMs, tz);
    if (expr === "end of week")        return this._startOfWeek(nowMs, tz) + 7 * 86400000 - 1;
    if (expr === "start of next week") return this._startOfWeek(nowMs, tz) + 7 * 86400000;
    if (expr === "start of last week") return this._startOfWeek(nowMs, tz) - 7 * 86400000;

    // "next Monday" … "next Sunday" / "last Monday" … "last Sunday"
    const relMatch = expr.match(
      /^(next|last)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/
    );
    if (relMatch) {
      const dir       = relMatch[1] as "next" | "last";
      const targetDow = DOW_INDEX[relMatch[2]];
      const { weekday } = decomposeDateInTZ(nowMs, tz);
      const todayDow  = DOW_INDEX[weekday.toLowerCase()];
      let delta = targetDow - todayDow;
      if (dir === "next") { if (delta <= 0) delta += 7; }
      else                { if (delta >= 0) delta -= 7; }
      return startOfDayMs(nowMs + delta * 86400000, tz);
    }

    // ISO string or any Date-parseable string (use original casing)
    const parsed = Date.parse(expression);
    if (!isNaN(parsed)) return parsed;

    throw new Error(`TimeService.resolve: unrecognised expression "${expression}"`);
  }

  /** Format a millisecond duration as a human-readable string (e.g. "3 hours 42 minutes"). */
  formatDuration(ms: number): string {
    const totalSeconds = Math.floor(Math.abs(ms) / 1000);
    const days    = Math.floor(totalSeconds / 86400);
    const hours   = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts: string[] = [];
    if (days)    parts.push(`${days} day${days    !== 1 ? "s" : ""}`);
    if (hours)   parts.push(`${hours} hour${hours  !== 1 ? "s" : ""}`);
    if (minutes) parts.push(`${minutes} minute${minutes !== 1 ? "s" : ""}`);
    if (parts.length === 0) {
      parts.push(`${seconds} second${seconds !== 1 ? "s" : ""}`);
    }
    return parts.join(" ");
  }

  /** Format a timestamp relative to now (e.g. "5 minutes ago", "in 2 hours"). */
  formatRelative(epochMs: number, nowMs: number = Date.now()): string {
    const diffMs = nowMs - epochMs;
    const absMs  = Math.abs(diffMs);
    const future = diffMs < 0;

    if (absMs < 30000) return "just now";

    const totalSeconds = Math.floor(absMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const hours   = Math.floor(minutes / 60);
    const days    = Math.floor(hours / 24);

    const label = (n: number, unit: string) =>
      future
        ? `in ${n} ${unit}${n !== 1 ? "s" : ""}`
        : `${n} ${unit}${n !== 1 ? "s" : ""} ago`;

    if (minutes < 60) return label(minutes, "minute");
    if (hours   < 24) return label(hours,   "hour");
    if (days    === 1) return future ? "tomorrow" : "yesterday";
    return label(days, "day");
  }

  /** Return a curated list of common IANA timezone identifiers. */
  commonZones(): string[] {
    return [
      // UTC
      "UTC",
      // Americas
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Anchorage",
      "Pacific/Honolulu",
      "America/Toronto",
      "America/Vancouver",
      "America/Mexico_City",
      "America/Sao_Paulo",
      "America/Argentina/Buenos_Aires",
      "America/Bogota",
      "America/Lima",
      // Europe
      "Europe/London",
      "Europe/Dublin",
      "Europe/Paris",
      "Europe/Berlin",
      "Europe/Rome",
      "Europe/Madrid",
      "Europe/Amsterdam",
      "Europe/Stockholm",
      "Europe/Helsinki",
      "Europe/Moscow",
      // Asia
      "Asia/Dubai",
      "Asia/Karachi",
      "Asia/Kolkata",
      "Asia/Kathmandu",
      "Asia/Dhaka",
      "Asia/Bangkok",
      "Asia/Singapore",
      "Asia/Shanghai",
      "Asia/Tokyo",
      "Asia/Seoul",
      // Pacific / Oceania
      "Australia/Sydney",
      "Pacific/Auckland",
    ];
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private _startOfWeek(epochMs: number, tz: string): number {
    const { weekday } = decomposeDateInTZ(epochMs, tz);
    const todayDow       = DOW_INDEX[weekday.toLowerCase()]; // Mon=1 … Sun=7
    const daysFromMonday = todayDow - 1;
    return startOfDayMs(epochMs - daysFromMonday * 86400000, tz);
  }

  private _buildAnchor(epochMs: number, tz: string): TimeAnchor {
    const parts     = decomposeDateInTZ(epochMs, tz);
    const isWeekend = parts.weekday === "Saturday" || parts.weekday === "Sunday";
    const sod       = startOfDayMs(epochMs, tz);
    const sow       = this._startOfWeek(epochMs, tz);

    return {
      epochMs,
      iso:              isoWithOffset(epochMs, tz),
      timezone:         tz,
      utcOffset:        utcOffsetString(epochMs, tz),
      timeOfDay:        formatTimeOfDay(epochMs, tz),
      date:             formatDateLong(epochMs, tz),
      dateShort:        formatDateShort(epochMs, tz),
      dayOfWeek:        parts.weekday,
      isWeekend,
      weekNumber:       isoWeekNumber(epochMs, tz),
      startOfDay:       sod,
      endOfDay:         sod + 86400000 - 1,
      startOfNextDay:   sod + 86400000,
      startOfYesterday: sod - 86400000,
      startOfWeek:      sow,
      endOfWeek:        sow + 7 * 86400000 - 1,
      startOfNextWeek:  sow + 7 * 86400000,
    };
  }
}
