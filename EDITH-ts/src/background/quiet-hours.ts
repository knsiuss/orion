import type { RuntimeQuietHours } from "./runtime-config.js"

const DEFAULT_QUIET_HOURS: RuntimeQuietHours = {
  start: "22:00",
  end: "07:00",
}

function toMinutes(time: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return null
  }

  const [hoursRaw, minutesRaw] = time.split(":")
  const hours = Number.parseInt(hoursRaw, 10)
  const minutes = Number.parseInt(minutesRaw, 10)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null
  }

  return (hours * 60) + minutes
}

/**
 * Check whether a clock time falls within the configured quiet-hours window.
 *
 * @param date The current date/time to test.
 * @param quietHours The normalized quiet-hours window.
 * @returns True when the provided time is inside quiet hours.
 */
export function isWithinQuietHours(
  date = new Date(),
  quietHours: RuntimeQuietHours = DEFAULT_QUIET_HOURS,
): boolean {
  const currentMinutes = (date.getHours() * 60) + date.getMinutes()
  const startMinutes = toMinutes(quietHours.start) ?? toMinutes(DEFAULT_QUIET_HOURS.start) ?? 1_320
  const endMinutes = toMinutes(quietHours.end) ?? toMinutes(DEFAULT_QUIET_HOURS.end) ?? 420

  if (startMinutes === endMinutes) {
    return true
  }

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes
}

export function isWithinHardQuietHours(
  date = new Date(),
  quietHours: RuntimeQuietHours = DEFAULT_QUIET_HOURS,
): boolean {
  return isWithinQuietHours(date, quietHours)
}

export const __quietHoursTestUtils = {
  DEFAULT_QUIET_HOURS,
  toMinutes,
}
