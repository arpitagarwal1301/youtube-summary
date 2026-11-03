import type { VideoRef } from '../shared/types';

export const PREFETCH_MAX_SECONDS = 9 * 60;
/** A video must stay on screen this long, so scrolling past it costs nothing. */
export const PREFETCH_DWELL_MS = 2500;
/** Wait after Gemini says it is busy or over a limit, which an automatic request should never make worse. */
export const PREFETCH_BACKOFF_MS = 5 * 60 * 1000;

export type VideoStatus = 'loading' | 'ready';

export function canPrefetch(video: VideoRef): boolean {
  if (video.isLive) return false;
  if (video.durationSeconds !== undefined) return video.durationSeconds < PREFETCH_MAX_SECONDS;
  // Shorts show no length on their cards, but are always far under the limit. Other cards with no length, such as Mixes, could be anything.
  return video.isShort === true;
}

/** Only while browsing. On a video's own page, the sidebar is not what the viewer is choosing from. */
export function isBrowsingPage(pathname: string): boolean {
  return pathname !== '/watch' && !pathname.startsWith('/shorts/') && !pathname.startsWith('/live/');
}

export interface PrefetchState {
  statuses: ReadonlyMap<string, VideoStatus>;
  failed: ReadonlySet<string>;
  firstSeen: ReadonlyMap<string, number>;
  hoveredId?: string;
  now: number;
}

/** The next video to prepare: the one under the pointer if possible, otherwise the highest on the page. */
export function pickNextPrefetch(videos: VideoRef[], state: PrefetchState): VideoRef | null {
  const eligible = videos.filter((video) => {
    const seen = state.firstSeen.get(video.videoId);
    return (
      canPrefetch(video) &&
      !state.statuses.has(video.videoId) &&
      !state.failed.has(video.videoId) &&
      seen !== undefined &&
      state.now - seen >= PREFETCH_DWELL_MS
    );
  });
  return eligible.find((video) => video.videoId === state.hoveredId) ?? eligible[0] ?? null;
}
