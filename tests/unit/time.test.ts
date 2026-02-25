/**
 * Unit tests for TimeService
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TimeService } from '../../src/time.js';
import type { TimeAnchor, TimeConversion } from '../../src/time.js';

describe('TimeService', () => {
  let ts: TimeService;

  beforeEach(() => {
    ts = new TimeService();
  });

  // ==========================================================================
  // Static Methods
  // ==========================================================================

  describe('static systemTimezone', () => {
    it('should return a non-empty IANA timezone string', () => {
      const tz = TimeService.systemTimezone();
      expect(typeof tz).toBe('string');
      expect(tz.length).toBeGreaterThan(0);
    });
  });

  describe('static isValidTimezone', () => {
    it('should return true for valid IANA timezones', () => {
      expect(TimeService.isValidTimezone('UTC')).toBe(true);
      expect(TimeService.isValidTimezone('America/New_York')).toBe(true);
      expect(TimeService.isValidTimezone('Europe/London')).toBe(true);
      expect(TimeService.isValidTimezone('Asia/Tokyo')).toBe(true);
    });

    it('should return false for invalid timezones', () => {
      expect(TimeService.isValidTimezone('Fake/Timezone')).toBe(false);
      expect(TimeService.isValidTimezone('')).toBe(false);
      expect(TimeService.isValidTimezone('NotAZone')).toBe(false);
    });
  });

  // ==========================================================================
  // now
  // ==========================================================================

  describe('now', () => {
    it('should return a valid TimeAnchor', () => {
      const anchor = ts.now('UTC');
      assertValidAnchor(anchor);
      expect(anchor.timezone).toBe('UTC');
    });

    it('should return current time within tolerance', () => {
      const before = Date.now();
      const anchor = ts.now('UTC');
      const after = Date.now();

      expect(anchor.epochMs).toBeGreaterThanOrEqual(before);
      expect(anchor.epochMs).toBeLessThanOrEqual(after);
    });

    it('should use system timezone when none provided', () => {
      const anchor = ts.now();
      expect(anchor.timezone).toBe(TimeService.systemTimezone());
    });

    it('should respect specified timezone', () => {
      const anchor = ts.now('America/New_York');
      expect(anchor.timezone).toBe('America/New_York');
    });
  });

  // ==========================================================================
  // atTime
  // ==========================================================================

  describe('atTime', () => {
    // 2026-02-25 12:00:00 UTC
    const fixedEpoch = Date.UTC(2026, 1, 25, 12, 0, 0);

    it('should return a valid TimeAnchor for a fixed epoch', () => {
      const anchor = ts.atTime(fixedEpoch, 'UTC');
      assertValidAnchor(anchor);
      expect(anchor.epochMs).toBe(fixedEpoch);
      expect(anchor.timezone).toBe('UTC');
    });

    it('should show correct date components', () => {
      const anchor = ts.atTime(fixedEpoch, 'UTC');
      expect(anchor.dayOfWeek).toBe('Wednesday');
      expect(anchor.date).toContain('February');
      expect(anchor.date).toContain('25');
      expect(anchor.date).toContain('2026');
    });

    it('should identify weekdays correctly', () => {
      // Wednesday 2026-02-25 is a weekday
      const weekday = ts.atTime(fixedEpoch, 'UTC');
      expect(weekday.isWeekend).toBe(false);

      // Saturday 2026-02-28
      const saturday = ts.atTime(fixedEpoch + 3 * 86400000, 'UTC');
      expect(saturday.isWeekend).toBe(true);

      // Sunday 2026-03-01
      const sunday = ts.atTime(fixedEpoch + 4 * 86400000, 'UTC');
      expect(sunday.isWeekend).toBe(true);
    });

    it('should compute correct day boundaries', () => {
      const anchor = ts.atTime(fixedEpoch, 'UTC');

      // Start of day should be midnight UTC
      expect(anchor.startOfDay).toBe(Date.UTC(2026, 1, 25, 0, 0, 0));
      expect(anchor.endOfDay).toBe(anchor.startOfDay + 86400000 - 1);
      expect(anchor.startOfNextDay).toBe(anchor.startOfDay + 86400000);
      expect(anchor.startOfYesterday).toBe(anchor.startOfDay - 86400000);
    });

    it('should compute correct week boundaries', () => {
      const anchor = ts.atTime(fixedEpoch, 'UTC');

      // 2026-02-25 is Wednesday, so start of week (Monday) is 2026-02-23
      const expectedMonday = Date.UTC(2026, 1, 23, 0, 0, 0);
      expect(anchor.startOfWeek).toBe(expectedMonday);
      expect(anchor.endOfWeek).toBe(expectedMonday + 7 * 86400000 - 1);
      expect(anchor.startOfNextWeek).toBe(expectedMonday + 7 * 86400000);
    });

    it('should format ISO string with timezone offset', () => {
      const anchor = ts.atTime(fixedEpoch, 'UTC');
      expect(anchor.iso).toMatch(/2026-02-25T12:00:00\.000\+00:00/);
    });

    it('should adjust ISO string for non-UTC timezone', () => {
      const anchor = ts.atTime(fixedEpoch, 'America/New_York');
      // EST is UTC-5, so 12:00 UTC = 07:00 EST
      expect(anchor.iso).toContain('07:00:00');
      expect(anchor.utcOffset).toBe('-05:00');
    });
  });

  // ==========================================================================
  // convert
  // ==========================================================================

  describe('convert', () => {
    const fixedEpoch = Date.UTC(2026, 1, 25, 12, 0, 0);

    it('should return a valid TimeConversion', () => {
      const conv = ts.convert(fixedEpoch, 'Asia/Tokyo');

      expect(conv.epochMs).toBe(fixedEpoch);
      expect(conv.timezone).toBe('Asia/Tokyo');
      expect(typeof conv.iso).toBe('string');
      expect(typeof conv.timeOfDay).toBe('string');
      expect(typeof conv.date).toBe('string');
      expect(typeof conv.utcOffset).toBe('string');
    });

    it('should show +09:00 for Tokyo', () => {
      const conv = ts.convert(fixedEpoch, 'Asia/Tokyo');
      expect(conv.utcOffset).toBe('+09:00');
    });

    it('should show UTC as +00:00', () => {
      const conv = ts.convert(fixedEpoch, 'UTC');
      expect(conv.utcOffset).toBe('+00:00');
    });
  });

  // ==========================================================================
  // resolve
  // ==========================================================================

  describe('resolve', () => {
    it('should resolve "now" to approximately current time', () => {
      const before = Date.now();
      const resolved = ts.resolve('now', 'UTC');
      const after = Date.now();

      expect(resolved).toBeGreaterThanOrEqual(before);
      expect(resolved).toBeLessThanOrEqual(after);
    });

    it('should resolve "today" to start of today', () => {
      const resolved = ts.resolve('today', 'UTC');
      const d = new Date(resolved);
      expect(d.getUTCHours()).toBe(0);
      expect(d.getUTCMinutes()).toBe(0);
      expect(d.getUTCSeconds()).toBe(0);
    });

    it('should resolve "yesterday" to start of yesterday', () => {
      const today = ts.resolve('today', 'UTC');
      const yesterday = ts.resolve('yesterday', 'UTC');
      expect(today - yesterday).toBe(86400000);
    });

    it('should resolve "tomorrow" to start of tomorrow', () => {
      const today = ts.resolve('today', 'UTC');
      const tomorrow = ts.resolve('tomorrow', 'UTC');
      expect(tomorrow - today).toBe(86400000);
    });

    it('should resolve "start of day"', () => {
      const result = ts.resolve('start of day', 'UTC');
      const d = new Date(result);
      expect(d.getUTCHours()).toBe(0);
      expect(d.getUTCMinutes()).toBe(0);
    });

    it('should resolve "end of day"', () => {
      const sod = ts.resolve('start of day', 'UTC');
      const eod = ts.resolve('end of day', 'UTC');
      expect(eod).toBe(sod + 86400000 - 1);
    });

    it('should resolve "start of week" to Monday', () => {
      const result = ts.resolve('start of week', 'UTC');
      const d = new Date(result);
      // getUTCDay: 0=Sun, 1=Mon
      expect(d.getUTCDay()).toBe(1);
    });

    it('should resolve "end of week" to end of Sunday', () => {
      const sow = ts.resolve('start of week', 'UTC');
      const eow = ts.resolve('end of week', 'UTC');
      expect(eow).toBe(sow + 7 * 86400000 - 1);
    });

    it('should resolve "start of next week"', () => {
      const sow = ts.resolve('start of week', 'UTC');
      const sonw = ts.resolve('start of next week', 'UTC');
      expect(sonw - sow).toBe(7 * 86400000);
    });

    it('should resolve "start of last week"', () => {
      const sow = ts.resolve('start of week', 'UTC');
      const solw = ts.resolve('start of last week', 'UTC');
      expect(sow - solw).toBe(7 * 86400000);
    });

    it('should resolve "next Monday" to a Monday in the future', () => {
      const result = ts.resolve('next Monday', 'UTC');
      const d = new Date(result);
      expect(d.getUTCDay()).toBe(1);
      expect(result).toBeGreaterThan(Date.now());
    });

    it('should resolve "last Sunday" to a Sunday in the past', () => {
      const result = ts.resolve('last Sunday', 'UTC');
      const d = new Date(result);
      expect(d.getUTCDay()).toBe(0);
      expect(result).toBeLessThan(Date.now());
    });

    it('should resolve bare epoch ms strings', () => {
      const epoch = '1740000000000';
      expect(ts.resolve(epoch)).toBe(1740000000000);
    });

    it('should resolve ISO date strings', () => {
      const iso = '2026-06-15T10:30:00.000Z';
      const result = ts.resolve(iso);
      expect(result).toBe(Date.parse(iso));
    });

    it('should throw for unrecognised expressions', () => {
      expect(() => ts.resolve('gibberish string')).toThrow(
        'unrecognised expression'
      );
    });

    it('should handle case-insensitivity', () => {
      expect(() => ts.resolve('NOW', 'UTC')).not.toThrow();
      expect(() => ts.resolve('Today', 'UTC')).not.toThrow();
      expect(() => ts.resolve('NEXT MONDAY', 'UTC')).not.toThrow();
    });
  });

  // ==========================================================================
  // formatDuration
  // ==========================================================================

  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(ts.formatDuration(5000)).toBe('5 seconds');
      expect(ts.formatDuration(1000)).toBe('1 second');
    });

    it('should format minutes', () => {
      expect(ts.formatDuration(60000)).toBe('1 minute');
      expect(ts.formatDuration(120000)).toBe('2 minutes');
    });

    it('should format hours', () => {
      expect(ts.formatDuration(3600000)).toBe('1 hour');
      expect(ts.formatDuration(7200000)).toBe('2 hours');
    });

    it('should format days', () => {
      expect(ts.formatDuration(86400000)).toBe('1 day');
      expect(ts.formatDuration(172800000)).toBe('2 days');
    });

    it('should combine units', () => {
      // 1 day + 2 hours + 30 minutes
      const ms = 86400000 + 7200000 + 1800000;
      expect(ts.formatDuration(ms)).toBe('1 day 2 hours 30 minutes');
    });

    it('should handle zero duration', () => {
      expect(ts.formatDuration(0)).toBe('0 seconds');
    });

    it('should handle negative durations (absolute value)', () => {
      expect(ts.formatDuration(-60000)).toBe('1 minute');
    });
  });

  // ==========================================================================
  // formatRelative
  // ==========================================================================

  describe('formatRelative', () => {
    const now = Date.now();

    it('should return "just now" for very recent times', () => {
      expect(ts.formatRelative(now - 10000, now)).toBe('just now');
      expect(ts.formatRelative(now + 10000, now)).toBe('just now');
    });

    it('should return minutes ago for recent past', () => {
      expect(ts.formatRelative(now - 5 * 60000, now)).toBe('5 minutes ago');
      expect(ts.formatRelative(now - 1 * 60000, now)).toBe('1 minute ago');
    });

    it('should return hours ago', () => {
      expect(ts.formatRelative(now - 3 * 3600000, now)).toBe('3 hours ago');
      expect(ts.formatRelative(now - 1 * 3600000, now)).toBe('1 hour ago');
    });

    it('should return "yesterday" for 1 day ago', () => {
      expect(ts.formatRelative(now - 86400000, now)).toBe('yesterday');
    });

    it('should return "N days ago" for multiple days', () => {
      expect(ts.formatRelative(now - 3 * 86400000, now)).toBe('3 days ago');
    });

    it('should return future relative times', () => {
      expect(ts.formatRelative(now + 5 * 60000, now)).toBe('in 5 minutes');
      expect(ts.formatRelative(now + 3 * 3600000, now)).toBe('in 3 hours');
    });

    it('should return "tomorrow" for 1 day in the future', () => {
      expect(ts.formatRelative(now + 86400000, now)).toBe('tomorrow');
    });
  });

  // ==========================================================================
  // commonZones
  // ==========================================================================

  describe('commonZones', () => {
    it('should return an array of strings', () => {
      const zones = ts.commonZones();
      expect(Array.isArray(zones)).toBe(true);
      expect(zones.length).toBeGreaterThan(30);
    });

    it('should include major timezones', () => {
      const zones = ts.commonZones();
      expect(zones).toContain('UTC');
      expect(zones).toContain('America/New_York');
      expect(zones).toContain('Europe/London');
      expect(zones).toContain('Asia/Tokyo');
      expect(zones).toContain('Australia/Sydney');
    });

    it('should contain only valid IANA timezones', () => {
      const zones = ts.commonZones();
      for (const tz of zones) {
        expect(TimeService.isValidTimezone(tz)).toBe(true);
      }
    });
  });
});

// ==========================================================================
// Helper
// ==========================================================================

function assertValidAnchor(anchor: TimeAnchor): void {
  expect(typeof anchor.epochMs).toBe('number');
  expect(typeof anchor.iso).toBe('string');
  expect(typeof anchor.timezone).toBe('string');
  expect(typeof anchor.utcOffset).toBe('string');
  expect(typeof anchor.timeOfDay).toBe('string');
  expect(typeof anchor.date).toBe('string');
  expect(typeof anchor.dateShort).toBe('string');
  expect(typeof anchor.dayOfWeek).toBe('string');
  expect(typeof anchor.isWeekend).toBe('boolean');
  expect(typeof anchor.weekNumber).toBe('number');
  expect(typeof anchor.startOfDay).toBe('number');
  expect(typeof anchor.endOfDay).toBe('number');
  expect(typeof anchor.startOfNextDay).toBe('number');
  expect(typeof anchor.startOfYesterday).toBe('number');
  expect(typeof anchor.startOfWeek).toBe('number');
  expect(typeof anchor.endOfWeek).toBe('number');
  expect(typeof anchor.startOfNextWeek).toBe('number');
}
