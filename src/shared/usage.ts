/** Gemini's free tier allows 8 hours of YouTube video a day. A paid plan would lift this limit here. */
export const DAILY_LIMIT_SECONDS = 8 * 60 * 60;
/** Answers prepared in advance stop here, so the rest of the day's limit stays free for the user's own clicks. */
export const PREFETCH_LIMIT_SECONDS = DAILY_LIMIT_SECONDS / 2;

/** Low media resolution is documented at about 100 tokens per second. Used when a card shows no duration. */
const TOKENS_PER_VIDEO_SECOND = 100;

const USAGE_KEY = 'usage';

/** Gemini's daily quotas reset at midnight Pacific time. */
export function quotaDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
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
