import { describe, it, expect, vi, afterEach } from "vitest";
import { formatRelativeTime } from "./time";

describe("formatRelativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for under 10 seconds ago", () => {
    const now = Date.parse("2026-01-01T00:00:10Z");
    vi.useFakeTimers().setSystemTime(now);
    expect(formatRelativeTime(now - 5_000)).toBe("just now");
  });

  it("returns seconds for under a minute ago", () => {
    const now = Date.parse("2026-01-01T00:00:30Z");
    vi.useFakeTimers().setSystemTime(now);
    expect(formatRelativeTime(now - 42_000)).toBe("42s ago");
  });

  it("returns minutes for under an hour ago", () => {
    const now = Date.parse("2026-01-01T01:00:00Z");
    vi.useFakeTimers().setSystemTime(now);
    expect(formatRelativeTime(now - 5 * 60_000)).toBe("5m ago");
  });

  it("returns hours for under a day ago", () => {
    const now = Date.parse("2026-01-02T00:00:00Z");
    vi.useFakeTimers().setSystemTime(now);
    expect(formatRelativeTime(now - 3 * 60 * 60_000)).toBe("3h ago");
  });

  it("returns days for a day or more ago", () => {
    const now = Date.parse("2026-01-10T00:00:00Z");
    vi.useFakeTimers().setSystemTime(now);
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60_000)).toBe("2d ago");
  });
});
