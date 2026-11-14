/** Gemini's free tier allows 8 hours of YouTube video a day. */
export const DAILY_LIMIT_SECONDS = 8 * 60 * 60;
/** Automatic answers stop here, so the rest of the day's limit stays free for the user's own clicks. */
export const AUTO_LIMIT_SECONDS = DAILY_LIMIT_SECONDS / 2;
/** Automatic answers skip anything longer, which would take minutes and a large share of the day's limit. */
export const AUTO_MAX_VIDEO_SECONDS = 30 * 60;

/** Low media resolution is documented at about 100 tokens per second. Used when a card shows no duration. */
const TOKENS_PER_VIDEO_SECOND = 100;

const USAGE_KEY = 'usage';
const QUOTA_ZONE = 'America/Los_Angeles';

/** Gemini's daily quotas reset at midnight Pacific time. */
export function quotaDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: QUOTA_ZONE }).format(now);
}

/** The moment the daily limit next resets. */
export function nextReset(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: QUOTA_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const sinceMidnight = read('hour') * 3600 + read('minute') * 60 + read('second');
  // Off by an hour on the two days a year the clocks change, which is close enough for a label.
  return new Date(now.getTime() + (86_400 - sinceMidnight) * 1000);
}

export async function getUsedSeconds(now: Date = new Date()): Promise<number> {
  const stored = await chrome.storage.local.get(USAGE_KEY);
  const usage = stored[USAGE_KEY] as { day: string; seconds: number } | undefined;
  return usage?.day === quotaDay(now) ? usage.seconds : 0;
}

export async function addUsedSeconds(seconds: number, now: Date = new Date()): Promise<void> {
  const used = await getUsedSeconds(now);
  await chrome.storage.local.set({ [USAGE_KEY]: { day: quotaDay(now), seconds: used + seconds } });
}

export function secondsForVideo(durationSeconds: number | undefined, videoTokens: number): number {
  return durationSeconds ?? Math.round(videoTokens / TOKENS_PER_VIDEO_SECOND);
}

/** "2 h 5 min", "48 min" or "under a minute". */
export function describeDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return minutes > 0 ? `${minutes} min` : 'under a minute';
}
