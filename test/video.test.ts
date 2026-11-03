import { describe, expect, it } from 'vitest';
import { formatClock, parseClock, parseVideoId, watchUrl } from '../src/shared/video';

const ID = 'dQw4w9WgXcQ';

describe('parseVideoId', () => {
  it.each([
    [`/watch?v=${ID}`],
    [`/watch?v=${ID}&list=RD${ID}&start_radio=1`],
    [`/watch?list=RD${ID}&v=${ID}`],
    [`/shorts/${ID}`],
    [`/live/${ID}`],
    [`https://www.youtube.com/watch?v=${ID}&t=30s`],
    [`https://m.youtube.com/watch?v=${ID}`],
    [`https://youtu.be/${ID}?si=abc`],
  ])('reads %s', (href) => {
    expect(parseVideoId(href)).toBe(ID);
  });

  it.each([
    ['/playlist?list=PL123'],
    ['/@somechannel'],
    ['/watch?v=short'],
    ['/results?search_query=x'],
    ['https://example.com/watch?v=dQw4w9WgXcQ'],
    ['https://notyoutube.com/watch?v=dQw4w9WgXcQ'],
    [''],
  ])('rejects %s', (href) => {
    expect(parseVideoId(href)).toBeNull();
  });
});

describe('watchUrl', () => {
  it('builds a plain watch URL', () => {
    expect(watchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });

  it('adds a start time', () => {
    expect(watchUrl(ID, 90)).toBe(`https://www.youtube.com/watch?v=${ID}&t=90s`);
  });
});

describe('clock helpers', () => {
  it('parses clocks', () => {
    expect(parseClock('6:16')).toBe(376);
    expect(parseClock(' 22:14 ')).toBe(1334);
    expect(parseClock('1:02:03')).toBe(3723);
  });

  it('ignores text that is not a clock', () => {
    expect(parseClock('LIVE')).toBeUndefined();
    expect(parseClock('')).toBeUndefined();
    expect(parseClock('12')).toBeUndefined();
  });

  it('formats clocks', () => {
    expect(formatClock(376)).toBe('6:16');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(5)).toBe('0:05');
  });
});
