/** Small counters that decide when to offer something once, kept apart from settings the user chooses. */
export interface Stats {
  /** Answers received, not counting ones reopened from today's saved answers. */
  answers: number;
  /** Clicks on the button on a video's own page. */
  pageClicks: number;
  /** The offer to answer opened videos automatically has been shown, or the switch has been used. */
  autoOfferDone: boolean;
  sponsorShown: number;
  sponsorLastShown: number;
  /** The sponsor line was clicked or dismissed, so it never appears again. */
  sponsorDone: boolean;
  /** The last version whose "What's new" the user opened. */
  seenVersion: string;
}

const STATS_KEY = 'stats';
const DEFAULTS: Stats = { answers: 0, pageClicks: 0, autoOfferDone: false, sponsorShown: 0, sponsorLastShown: 0, sponsorDone: false, seenVersion: '' };

export const AUTO_OFFER_AFTER_CLICKS = 3;
const SPONSOR_AFTER_ANSWERS = 10;
const SPONSOR_MAX_TIMES = 3;
const SPONSOR_GAP_MS = 24 * 60 * 60 * 1000;

export async function getStats(): Promise<Stats> {
  const stored = await chrome.storage.local.get(STATS_KEY);
  return { ...DEFAULTS, ...(stored[STATS_KEY] as Partial<Stats> | undefined) };
}

export async function updateStats(change: (stats: Stats) => void): Promise<Stats> {
  const stats = await getStats();
  change(stats);
  await chrome.storage.local.set({ [STATS_KEY]: stats });
  return stats;
}

/** After a few uses of the button on a video's page, it is worth asking once whether to make it automatic. */
export function shouldOfferAuto(stats: Stats, autoAnswer: boolean): boolean {
  return !autoAnswer && !stats.autoOfferDone && stats.pageClicks >= AUTO_OFFER_AFTER_CLICKS;
}

/** Only once the extension has proved useful, only a few times, and never again after a click or dismissal. */
export function shouldNudgeSponsor(stats: Stats, now = Date.now()): boolean {
  return (
    !stats.sponsorDone &&
    stats.answers >= SPONSOR_AFTER_ANSWERS &&
    stats.sponsorShown < SPONSOR_MAX_TIMES &&
    now - stats.sponsorLastShown >= SPONSOR_GAP_MS
  );
}
