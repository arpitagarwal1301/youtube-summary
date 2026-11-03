import { describe, expect, it } from 'vitest';
import { PREFETCH_DWELL_MS, canPrefetch, isBrowsingPage, pickNextPrefetch, type PrefetchState } from '../src/content/prefetch';
import type { VideoRef } from '../src/shared/types';

const NOW = 100_000;
const video = (videoId: string, durationSeconds?: number, extra: Partial<VideoRef> = {}): VideoRef => ({
  videoId,
  title: videoId,
  durationSeconds,
  ...extra,
});

function state(videos: VideoRef[], change: Partial<PrefetchState> = {}): PrefetchState {
  return {
    statuses: new Map(),
    failed: new Set(),
    firstSeen: new Map(videos.map((item) => [item.videoId, NOW - PREFETCH_DWELL_MS])),
    now: NOW,
    ...change,
  };
}

describe('canPrefetch', () => {
  it('takes videos under 9 minutes only', () => {
    expect(canPrefetch(video('a', 60))).toBe(true);
    expect(canPrefetch(video('a', 539))).toBe(true);
    expect(canPrefetch(video('a', 540))).toBe(false);
    expect(canPrefetch(video('a', 3600))).toBe(false);
  });

  it('takes Shorts, which show no length', () => {
    expect(canPrefetch(video('a', undefined, { isShort: true }))).toBe(true);
  });

  it('skips cards with no known length, such as Mixes', () => {
    expect(canPrefetch(video('a'))).toBe(false);
  });

  it('skips live streams', () => {
    expect(canPrefetch(video('a', undefined, { isLive: true, isShort: true }))).toBe(false);
    expect(canPrefetch(video('a', 60, { isLive: true }))).toBe(false);
  });
});

describe('isBrowsingPage', () => {
  it.each(['/', '/results', '/feed/subscriptions', '/@somechannel/videos'])('allows %s', (path) => {
    expect(isBrowsingPage(path)).toBe(true);
  });

  it.each(['/watch', '/shorts/abc', '/live/abc'])('skips %s', (path) => {
    expect(isBrowsingPage(path)).toBe(false);
  });
});

describe('pickNextPrefetch', () => {
  it('takes the highest video on the page first', () => {
    const videos = [video('a', 60), video('b', 60)];
    expect(pickNextPrefetch(videos, state(videos))?.videoId).toBe('a');
  });

  it('prefers the video under the pointer', () => {
    const videos = [video('a', 60), video('b', 60)];
    expect(pickNextPrefetch(videos, state(videos, { hoveredId: 'b' }))?.videoId).toBe('b');
  });

  it('skips a long video, even under the pointer', () => {
    const videos = [video('a', 60), video('long', 3600)];
    expect(pickNextPrefetch(videos, state(videos, { hoveredId: 'long' }))?.videoId).toBe('a');
  });

  it('waits until a video has stayed on screen long enough', () => {
    const videos = [video('a', 60)];
    const firstSeen = new Map([['a', NOW - PREFETCH_DWELL_MS + 1]]);
    expect(pickNextPrefetch(videos, state(videos, { firstSeen }))).toBeNull();
  });

  it('skips videos already loading, ready or failed', () => {
    const videos = [video('loading', 60), video('ready', 60), video('failed', 60), video('next', 60)];
    const picked = pickNextPrefetch(
      videos,
      state(videos, {
        statuses: new Map([['loading', 'loading'], ['ready', 'ready']]),
        failed: new Set(['failed']),
      }),
    );
    expect(picked?.videoId).toBe('next');
  });

  it('returns nothing when no video qualifies', () => {
    expect(pickNextPrefetch([], state([]))).toBeNull();
  });
});
