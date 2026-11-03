import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRequestBody, describeHttpError, interpretResponse, runGemini } from '../src/background/gemini';
import { DEFAULT_MODEL } from '../src/shared/settings';
import type { GeminiJob, VideoRef } from '../src/shared/types';

const video: VideoRef = { videoId: 'dQw4w9WgXcQ', title: 'You will not believe this', channel: 'Some Channel', durationSeconds: 120 };
const job: GeminiJob = { video, apiKey: 'test-key', model: 'gemini-3.8-flash', language: 'english' };

function responseWith(text: string, extra: object = {}) {
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }], ...extra };
}

afterEach(() => vi.unstubAllGlobals());

describe('buildRequestBody', () => {
  it('sends the video first, as a plain watch URL, at low resolution', () => {
    const body = buildRequestBody({ ...job, video: { ...video, videoId: 'abcdefghijk' } });
    const [videoPart, textPart] = body.contents[0].parts;
    expect(videoPart).toEqual({ fileData: { fileUri: 'https://www.youtube.com/watch?v=abcdefghijk' } });
    expect((textPart as { text: string }).text).toContain('You will not believe this');
    expect((textPart as { text: string }).text).toContain('2:00');
    expect(body.generationConfig.mediaResolution).toBe('MEDIA_RESOLUTION_LOW');
    expect(body.generationConfig.responseFormat.text.mimeType).toBe('APPLICATION_JSON');
  });

  it('follows the language setting', () => {
    const text = (language: GeminiJob['language']) =>
      (buildRequestBody({ ...job, language }).contents[0].parts[1] as { text: string }).text;
    expect(text('english')).toContain('in English');
    expect(text('video')).toContain('language of the video');
  });
});

describe('interpretResponse', () => {
  it('returns the answer and video tokens', () => {
    const outcome = interpretResponse(
      responseWith('{"answer":"Yes"}', {
        usageMetadata: {
          promptTokensDetails: [
            { modality: 'TEXT', tokenCount: 50 },
            { modality: 'VIDEO', tokenCount: 9000 },
          ],
        },
      }),
      video,
    );
    expect(outcome).toMatchObject({ ok: true, videoTokens: 9000, answer: { answer: 'Yes' } });
  });

  it('skips thought parts', () => {
    const body = {
      candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: '{"answer":"Yes"}' }] } }],
    };
    expect(interpretResponse(body, video).ok).toBe(true);
  });

  it.each(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT'])('reports %s as blocked', (finishReason) => {
    const outcome = interpretResponse({ candidates: [{ finishReason }] }, video);
    expect(outcome).toMatchObject({ ok: false, error: { code: 'blocked' } });
  });

  it('reports a blocked prompt', () => {
    const outcome = interpretResponse({ promptFeedback: { blockReason: 'SAFETY' } }, video);
    expect(outcome).toMatchObject({ ok: false, error: { code: 'blocked' } });
  });

  it('reports unreadable output', () => {
    expect(interpretResponse(responseWith('oops'), video)).toMatchObject({ ok: false, error: { code: 'bad_response' } });
    expect(interpretResponse(null, video)).toMatchObject({ ok: false, error: { code: 'bad_response' } });
  });
});

describe('describeHttpError', () => {
  const error = (message: string) => ({ error: { message } });

  it.each([
    [400, 'API key not valid. Please pass a valid API key.', 'invalid_key'],
    [401, '', 'invalid_key'],
    [403, 'Permission denied', 'invalid_key'],
    [429, 'You exceeded your current quota, tokens per minute', 'rate_limited'],
    [400, 'The input token count (2000000) exceeds the maximum number of tokens allowed (1048576).', 'too_long'],
    [400, 'Cannot fetch content from the provided URL. Video is private.', 'unavailable'],
    [500, 'Internal error', 'server'],
    [503, 'This model is currently experiencing high demand.', 'overloaded'],
    [400, 'Unknown name "foo"', 'rejected'],
  ])('maps %i "%s" to %s', (status, message, code) => {
    expect(describeHttpError(status, error(message)).code).toBe(code);
  });

  it('includes the reason in an unrecognised rejection', () => {
    expect(describeHttpError(400, error('Unknown name "foo"')).message).toContain('Unknown name "foo"');
  });

  it('copes with a non-JSON error body', () => {
    expect(describeHttpError(502, null).code).toBe('server');
  });
});

describe('runGemini', () => {
  it('sends the key as a header, never in the URL', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify(responseWith('{"answer":"Yes"}'))));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await runGemini(job);

    expect(outcome.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gemini.test/v1beta/models/gemini-3.8-flash:generateContent');
    expect(url).not.toContain('test-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
  });

  it('reports a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await runGemini(job)).toMatchObject({ ok: false, error: { code: 'network' } });
  });

  it('reports a timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }),
    );
    expect(await runGemini(job, undefined, 5)).toMatchObject({ ok: false, error: { code: 'timeout' } });
  });

  it('reports an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })));
    expect(await runGemini(job)).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
  });

  describe('when the chosen model cannot answer', () => {
    const modelsCalled = (fetchMock: ReturnType<typeof vi.fn>) =>
      fetchMock.mock.calls.map(([url]) => String(url).match(/models\/(.+):/)?.[1]);

    it('uses Flash-Lite by default, as the most reliable in testing', () => {
      expect(DEFAULT_MODEL).toBe('gemini-3.5-flash-lite');
    });

    it.each([503, 429])('switches to the fallback model on HTTP %i', async (status) => {
      const fetchMock = vi.fn(async (url: string) =>
        url.includes('gemini-3.8-flash')
          ? new Response('{}', { status })
          : new Response(JSON.stringify(responseWith('{"answer":"Yes"}'))),
      );
      vi.stubGlobal('fetch', fetchMock);

      expect(await runGemini(job)).toMatchObject({ ok: true, answer: { answer: 'Yes' } });
      expect(modelsCalled(fetchMock)).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    });

    it('reports the failure if the fallback is busy too', async () => {
      const fetchMock = vi.fn(async () => new Response('{}', { status: 503 }));
      vi.stubGlobal('fetch', fetchMock);

      expect(await runGemini(job)).toMatchObject({ ok: false, error: { code: 'overloaded' } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry when already on the fallback model', async () => {
      const fetchMock = vi.fn(async () => new Response('{}', { status: 503 }));
      vi.stubGlobal('fetch', fetchMock);

      await runGemini({ ...job, model: 'gemini-3.5-flash-lite' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      [400, 'API key not valid.'],
      [400, 'Video is private.'],
      [500, 'Internal error'],
    ])('does not switch on HTTP %i "%s"', async (status, message) => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message } }), { status }));
      vi.stubGlobal('fetch', fetchMock);

      await runGemini(job);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
