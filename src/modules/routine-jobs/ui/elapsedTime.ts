const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const CLOCK_PAD_LENGTH = 2;

const pad = (value: number): string => String(value).padStart(CLOCK_PAD_LENGTH, "0");

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / MS_PER_SECOND));
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  const clock = `${pad(minutes)}:${pad(seconds)}`;
  return hours > 0 ? `${hours}:${clock}` : clock;
}
