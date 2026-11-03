import { afterEach, describe, expect, it, vi } from 'vitest';
import { addPageDetails, parsePageDetails } from '../src/background/details';
import { buildPrompt } from '../src/background/prompt';
import type { VideoRef } from '../src/shared/types';

const video: VideoRef = { videoId: 'dQw4w9WgXcQ', title: 'Headline' };
const page = `<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"dQw4w9WgXcQ","lengthSeconds":"773",
  "keywords":["khiladi 786","akshay \\"AK\\" kumar"],"shortDescription":"Watch the scene from Khiladi 786.\\nLine two."}};</script>`;

afterEach(() => vi.unstubAllGlobals());

describe('parsePageDetails', () => {
  it('reads the description, tags and length, including escaped characters', () => {
    expect(parsePageDetails(page)).toEqual({
      description: 'Watch the scene from Khiladi 786.\nLine two.',
      keywords: ['khiladi 786', 'akshay "AK" kumar'],
      durationSeconds: 773,
    });
  });

  it('returns nothing from a page without them, such as a consent page', () => {
    expect(parsePageDetails('<html>Before you continue</html>')).toEqual({});
  });

  it('limits the description length', () => {
    const long = `{"shortDescription":"${'x'.repeat(5000)}"}`;
    expect(parsePageDetails(long).description).toHaveLength(1500);
  });
});

describe('addPageDetails', () => {
  it('adds details, without cookies', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => new Response(page));
    vi.stubGlobal('fetch', fetchMock);

    const result = await addPageDetails(video);

    expect(result.description).toContain('Khiladi 786');
    expect(result.durationSeconds).toBe(773);
    expect((fetchMock.mock.calls[0][1] as RequestInit).credentials).toBe('omit');
  });

  it('keeps what the card already knows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(page)));
    const result = await addPageDetails({ ...video, durationSeconds: 100 });
    expect(result.durationSeconds).toBe(100);
    expect(result.title).toBe('Headline');
  });

  it.each([
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['an error page', async () => new Response('', { status: 500 })],
  ])('carries on without details after %s', async (_name, respond) => {
    vi.stubGlobal('fetch', vi.fn(respond));
    expect(await addPageDetails(video)).toEqual(video);
  });
});

describe('buildPrompt', () => {
  it('includes details when present, and leaves them out when not', () => {
    const withDetails = buildPrompt({ ...video, description: 'About the film', keywords: ['one', 'two'] }, 'english');
    expect(withDetails).toContain("Uploader's description:\nAbout the film");
    expect(withDetails).toContain("Uploader's tags: one, two");

    const without = buildPrompt(video, 'english');
    expect(without).not.toContain("Uploader's description:");
    expect(without).not.toContain("Uploader's tags:");
  });
});
