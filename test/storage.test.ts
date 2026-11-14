import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answerKey, clearSaved, findSaved, listSaved, readSaved, removeOld, savedSeconds, startOfToday, writeSaved, type SavedAnswer } from '../src/shared/saved';
import { AUTO_MODEL, getSettings, resolveModels, saveSettings, updateSettings } from '../src/shared/settings';
import { getStats, shouldNudgeSponsor, shouldOfferAuto, updateStats, type Stats } from '../src/shared/stats';
import type { VideoAnswer } from '../src/shared/types';
import { addUsedSeconds, describeDuration, getUsedSeconds, nextReset, quotaDay, secondsForVideo } from '../src/shared/usage';

const answer: VideoAnswer = {
  category: 'other',
  question: '',
  answer: 'Yes',
  keyPoints: [],
  summary: [],
  confidence: 'high',
  titleDelivers: true,
};

const HOUR = 3_600_000;
const entry = (videoId: string, savedAt: number, extra: Partial<SavedAnswer> = {}): SavedAnswer => ({
  video: { videoId, title: `Video ${videoId}`, durationSeconds: 600 },
  answer,
  savedAt,
  source: 'thumbnail',
  ...extra,
});

let data: Record<string, unknown>;
beforeEach(() => {
  data = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string | string[] | null) => {
          if (key === null) return { ...data };
          return Object.fromEntries([key].flat().filter((name) => name in data).map((name) => [name, data[name]]));
        },
        set: async (items: Record<string, unknown>) => void Object.assign(data, items),
        remove: async (keys: string | string[]) => [keys].flat().forEach((key) => delete data[key]),
      },
    },
  });
});

describe('saved answers', () => {
  it('keeps languages separate', async () => {
    const now = Date.now();
    await writeSaved(answerKey('abc', 'english'), entry('abc', now));
    expect((await readSaved(answerKey('abc', 'english'), now))?.answer).toEqual(answer);
    expect(await readSaved(answerKey('abc', 'video'), now)).toBeNull();
  });

  it('keeps answers for a day', async () => {
    const key = answerKey('abc', 'english');
    await writeSaved(key, entry('abc', 0));
    expect(await readSaved(key, 23 * HOUR)).not.toBeNull();
    expect(await readSaved(key, 25 * HOUR)).toBeNull();
  });

  it('reports which answers are saved and still fresh', async () => {
    const fresh = answerKey('fresh', 'english');
    data[fresh] = entry('fresh', 30 * HOUR);
    data[answerKey('old', 'english')] = entry('old', 0);
    const found = await findSaved([fresh, answerKey('old', 'english'), answerKey('never', 'english')], 31 * HOUR);
    expect([...found]).toEqual([fresh]);
  });

  it('lists today’s answers newest first', async () => {
    data[answerKey('a', 'english')] = entry('a', 10 * HOUR);
    data[answerKey('b', 'english')] = entry('b', 12 * HOUR);
    data[answerKey('gone', 'english')] = entry('gone', 0);
    expect((await listSaved(25 * HOUR)).map((item) => item.video.videoId)).toEqual(['b', 'a']);
  });

  it('drops answers in an older format and the oldest past 200', async () => {
    data['answer:5:english:legacy'] = { answer, savedAt: 100 };
    for (let i = 0; i < 202; i++) data[answerKey(`v${i}`, 'english')] = entry(`v${i}`, 1000 + i);
    await removeOld(2000);
    expect(data['answer:5:english:legacy']).toBeUndefined();
    expect(data[answerKey('v0', 'english')]).toBeUndefined();
    expect(data[answerKey('v1', 'english')]).toBeUndefined();
    expect(data[answerKey('v201', 'english')]).toBeDefined();
    expect(Object.keys(data).filter((key) => key.startsWith('answer:'))).toHaveLength(200);
  });

  it('clearing leaves settings alone', async () => {
    await saveSettings({ apiKey: 'k', model: AUTO_MODEL, language: 'video', autoAnswer: false, notifications: true });
    await writeSaved(answerKey('abc', 'english'), entry('abc', Date.now()));
    await clearSaved();
    expect(await listSaved()).toEqual([]);
    expect((await getSettings()).apiKey).toBe('k');
  });

  it('counts the length of every video answered since a moment', () => {
    expect(savedSeconds([entry('a', 10), entry('b', 10, { source: 'page' }), entry('c', 10, { source: 'auto' }), entry('old', 1)], 5)).toBe(1800);
  });

  it("starts today at the user's own midnight", () => {
    const now = new Date(2026, 10, 15, 14, 30).getTime();
    expect(new Date(startOfToday(now))).toEqual(new Date(2026, 10, 15));
  });
});

describe('settings', () => {
  it('has defaults before anything is saved', async () => {
    expect(await getSettings()).toEqual({ apiKey: '', model: AUTO_MODEL, language: 'english', autoAnswer: false, notifications: true });
  });

  it('moves people from 1.0 to the automatic model but keeps their key and language', async () => {
    data.settings = { apiKey: 'k', model: 'gemini-3.5-flash-lite', language: 'video', prefetch: true };
    expect(await getSettings()).toEqual({ apiKey: 'k', model: AUTO_MODEL, language: 'video', autoAnswer: false, notifications: true });
  });

  it('keeps a model chosen in this version', async () => {
    await updateSettings({ model: 'gemini-3.1-flash-lite', autoAnswer: true });
    expect(await getSettings()).toMatchObject({ model: 'gemini-3.1-flash-lite', autoAnswer: true });
  });

  it('falls back to the other model', () => {
    const models = { auto: 'lite-latest', fallback: 'lite-3.1' };
    expect(resolveModels(AUTO_MODEL, models)).toEqual({ model: 'lite-latest', fallbackModel: 'lite-3.1' });
    expect(resolveModels('pinned', models)).toEqual({ model: 'pinned', fallbackModel: 'lite-latest' });
    expect(resolveModels('lite-latest', models)).toEqual({ model: 'lite-latest', fallbackModel: 'lite-3.1' });
  });
});

describe('stats', () => {
  const stats = (change: Partial<Stats>): Stats => ({
    answers: 0,
    pageClicks: 0,
    autoOfferDone: false,
    sponsorShown: 0,
    sponsorLastShown: 0,
    sponsorDone: false,
    seenVersion: '',
    ...change,
  });

  it('saves counters', async () => {
    await updateStats((s) => (s.answers += 2));
    expect((await getStats()).answers).toBe(2);
  });

  it('offers automatic answers after the third page click, once', () => {
    expect(shouldOfferAuto(stats({ pageClicks: 2 }), false)).toBe(false);
    expect(shouldOfferAuto(stats({ pageClicks: 3 }), false)).toBe(true);
    expect(shouldOfferAuto(stats({ pageClicks: 3 }), true)).toBe(false);
    expect(shouldOfferAuto(stats({ pageClicks: 9, autoOfferDone: true }), false)).toBe(false);
  });

  it('asks for sponsorship only after 10 answers, at most 3 times, a day apart', () => {
    const day = 24 * HOUR;
    expect(shouldNudgeSponsor(stats({ answers: 9 }), day)).toBe(false);
    expect(shouldNudgeSponsor(stats({ answers: 10 }), day)).toBe(true);
    expect(shouldNudgeSponsor(stats({ answers: 10, sponsorShown: 1, sponsorLastShown: day }), day + HOUR)).toBe(false);
    expect(shouldNudgeSponsor(stats({ answers: 10, sponsorShown: 1, sponsorLastShown: day }), 2 * day)).toBe(true);
    expect(shouldNudgeSponsor(stats({ answers: 10, sponsorShown: 3 }), 9 * day)).toBe(false);
    expect(shouldNudgeSponsor(stats({ answers: 10, sponsorDone: true }), 9 * day)).toBe(false);
  });
});

describe('daily usage', () => {
  it('uses the Pacific calendar day', () => {
    expect(quotaDay(new Date('2026-11-03T07:59:00Z'))).toBe('2026-11-02');
    expect(quotaDay(new Date('2026-11-03T08:01:00Z'))).toBe('2026-11-03');
  });

  it('resets at Pacific midnight', () => {
    // 8 Nov 2026 is after the clocks change, so Pacific is UTC-8.
    expect(nextReset(new Date('2026-11-10T20:00:00Z')).toISOString()).toBe('2026-11-11T08:00:00.000Z');
  });

  it('adds up within a day and resets the next day', async () => {
    const today = new Date('2026-11-03T12:00:00Z');
    await addUsedSeconds(100, today);
    await addUsedSeconds(50, today);
    expect(await getUsedSeconds(today)).toBe(150);
    expect(await getUsedSeconds(new Date('2026-11-04T12:00:00Z'))).toBe(0);
  });

  it('estimates from tokens when the length is unknown', () => {
    expect(secondsForVideo(600, 1)).toBe(600);
    expect(secondsForVideo(undefined, 12_000)).toBe(120);
  });

  it('describes durations briefly', () => {
    expect(describeDuration(7500)).toBe('2 h 5 min');
    expect(describeDuration(7200)).toBe('2 h');
    expect(describeDuration(2880)).toBe('48 min');
    expect(describeDuration(30)).toBe('under a minute');
  });
});
