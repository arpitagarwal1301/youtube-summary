import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, parseRemoteConfig } from '../src/shared/remote';
import { shareText } from '../src/shared/share';
import type { VideoAnswer } from '../src/shared/types';

describe('parseRemoteConfig', () => {
  it('uses the built-in values for anything missing or broken', () => {
    expect(parseRemoteConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(parseRemoteConfig('nonsense')).toEqual(DEFAULT_CONFIG);
    expect(parseRemoteConfig({ models: 7, selectors: [], links: 'x' })).toEqual(DEFAULT_CONFIG);
  });

  it('takes valid model names and rejects others', () => {
    const config = parseRemoteConfig({ models: { auto: 'gemini-4-flash-lite', fallback: 'Bad Name/../x' } });
    expect(config.models).toEqual({ auto: 'gemini-4-flash-lite', fallback: DEFAULT_CONFIG.models.fallback });
  });

  it('takes selectors but never anything that could be markup or style', () => {
    const config = parseRemoteConfig({ selectors: { card: 'yt-new-card', ad: '</style><script>', preview: 'a{color:red}', unknown: 'x' } });
    expect(config.selectors.card).toBe('yt-new-card');
    expect(config.selectors.ad).toBe(DEFAULT_CONFIG.selectors.ad);
    expect(config.selectors.preview).toBe(DEFAULT_CONFIG.selectors.preview);
    expect('unknown' in config.selectors).toBe(false);
  });

  it('only takes links to the project’s own hosts, and mail only for feedback', () => {
    const config = parseRemoteConfig({
      links: {
        sponsor: 'https://evil.example/pay',
        github: 'http://github.com/x',
        whatsNew: 'https://github.com/arpitagarwal1301/youtube-summary/blob/main/CHANGELOG.md',
        feedback: 'mailto:someone@example.com',
        share: 'mailto:someone@example.com',
        privacy: 'javascript:alert(1)',
      },
    });
    expect(config.links.sponsor).toBe(DEFAULT_CONFIG.links.sponsor);
    expect(config.links.github).toBe(DEFAULT_CONFIG.links.github);
    expect(config.links.whatsNew).toContain('CHANGELOG.md');
    expect(config.links.feedback).toBe('mailto:someone@example.com');
    expect(config.links.share).toBe(DEFAULT_CONFIG.links.share);
    expect(config.links.privacy).toBe(DEFAULT_CONFIG.links.privacy);
  });

  it('trims a notice and drops a bad link on it', () => {
    const config = parseRemoteConfig({ notice: { id: 'n1', text: ` ${'x'.repeat(300)} `, url: 'https://evil.example' } });
    expect(config.notice).toEqual({ id: 'n1', text: 'x'.repeat(200) });
    expect(parseRemoteConfig({ notice: { id: '', text: 'hi' } }).notice).toBeNull();
  });
});

describe('shareText', () => {
  const answer: VideoAnswer = {
    category: 'movie_tv',
    question: 'Which film?',
    answer: 'It is **Dune**.',
    keyPoints: ['Released **2021**'],
    summary: [],
    confidence: 'high',
    titleDelivers: true,
  };

  it('reads well without markup and says where it came from', () => {
    expect(shareText({ videoId: 'abc', title: 'Best film ever', durationSeconds: 900 }, answer, 'https://github.com/x/y')).toBe(
      ['Saved you 15 min: It is Dune.', '• Released 2021', '', 'Best film ever https://youtu.be/abc', 'via Know It for YouTube https://github.com/x/y'].join('\n'),
    );
  });

  it('leaves out the time saved for a very short video', () => {
    expect(shareText({ videoId: 'abc', title: '', durationSeconds: 20 }, answer, 'u').startsWith('It is Dune.')).toBe(true);
  });
});
