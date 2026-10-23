const MS_PER_SECOND = 1000;
const TENTHS_PER_MINUTE = 600;
const ZERO_DURATION_TEXT = "0 ms";

const formatMillis = (roundedMs: number): string => `${roundedMs} ms`;

const formatSecondsWithTenths = (tenths: number): string => `${Math.floor(tenths / 10)},${tenths % 10} s`;

const formatMinutesAndSeconds = (roundedMs: number): string => {
  const totalSeconds = Math.round(roundedMs / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes} min ${seconds} s`;
};

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return ZERO_DURATION_TEXT;
  const roundedMs = Math.round(durationMs);
  if (roundedMs < MS_PER_SECOND) return formatMillis(roundedMs);
  const tenths = Math.round(roundedMs / 100);
  if (tenths < TENTHS_PER_MINUTE) return formatSecondsWithTenths(tenths);
  return formatMinutesAndSeconds(roundedMs);
}
