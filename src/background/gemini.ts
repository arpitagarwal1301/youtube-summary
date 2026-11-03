import { ANSWER_SCHEMA, parseAnswer } from '../shared/answer';
import { FALLBACK_MODEL } from '../shared/settings';
import type { AnswerError, GeminiJob, GeminiOutcome, VideoRef } from '../shared/types';
import { watchUrl } from '../shared/video';
import { buildPrompt } from './prompt';

/** Replaced at build time, so end-to-end tests can point at a local mock server. */
declare const __GEMINI_BASE__: string;

export const GEMINI_BASE = __GEMINI_BASE__;

const REQUEST_TIMEOUT_MS = 4 * 60 * 1000;
const CAN_FALL_BACK: AnswerError['code'][] = ['overloaded', 'rate_limited'];

export type MediaResolution = 'MEDIA_RESOLUTION_LOW' | 'MEDIA_RESOLUTION_MEDIUM';

export function buildRequestBody(job: GeminiJob, mediaResolution: MediaResolution = 'MEDIA_RESOLUTION_LOW') {
  return {
    contents: [
      {
        parts: [
          { fileData: { fileUri: watchUrl(job.video.videoId) } },
          { text: buildPrompt(job.video, job.language) },
        ],
      },
    ],
    generationConfig: {
      // Low resolution uses about a third of the tokens, which keeps long videos inside free-tier limits.
      mediaResolution,
      responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: ANSWER_SCHEMA } },
    },
  };
}

export async function runGemini(
  job: GeminiJob,
  mediaResolution?: MediaResolution,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<GeminiOutcome> {
  const deadline = Date.now() + timeoutMs;
  const first = await callModel(job.model, job, mediaResolution, timeoutMs);
  if (first.ok || job.model === FALLBACK_MODEL || !CAN_FALL_BACK.includes(first.error.code)) return first;

  // Busy periods and free-tier quotas are per model, so another model can often still answer.
  const remaining = deadline - Date.now();
  return remaining > 0 ? callModel(FALLBACK_MODEL, job, mediaResolution, remaining) : first;
}

async function callModel(
  model: string,
  job: GeminiJob,
  mediaResolution: MediaResolution | undefined,
  timeoutMs: number,
): Promise<GeminiOutcome> {
  let response: Response;
  let body: unknown;
  try {
    response = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': job.apiKey },
      body: JSON.stringify(buildRequestBody(job, mediaResolution)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    body = await response.json().catch(() => null);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return fail('timeout', 'Gemini took too long on this video. Try again, or try a shorter video.');
    }
    return fail('network', 'Could not reach Gemini. Check your connection and try again.');
  }

  if (!response.ok) return { ok: false, error: describeHttpError(response.status, body) };
  return interpretResponse(body, job.video);
}

interface GeminiResponse {
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokensDetails?: { modality?: string; tokenCount?: number }[] };
  modelVersion?: string;
}

export function interpretResponse(body: unknown, video: VideoRef): GeminiOutcome {
  const data = (body ?? {}) as GeminiResponse;

  if (data.promptFeedback?.blockReason) return blocked();

  const candidate = data.candidates?.[0];
  const reason = candidate?.finishReason;
  if (reason && ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(reason)) return blocked();

  const text = (candidate?.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? '')
    .join('');
  const answer = parseAnswer(text, video);
  if (!answer) return fail('bad_response', 'Gemini returned an answer that could not be read. Try again.');

  const videoTokens = (data.usageMetadata?.promptTokensDetails ?? [])
    .filter((entry) => entry.modality === 'VIDEO')
    .reduce((sum, entry) => sum + (entry.tokenCount ?? 0), 0);

  return { ok: true, answer, videoTokens, modelVersion: data.modelVersion };
}

export function describeHttpError(status: number, body: unknown): AnswerError {
  const message = ((body as { error?: { message?: string } } | null)?.error?.message ?? '').trim();
  const lower = message.toLowerCase();

  if (lower.includes('api key') || status === 401) {
    return { code: 'invalid_key', message: 'Gemini did not accept your API key. Check it in settings.' };
  }
  if (status === 429) {
    return {
      code: 'rate_limited',
      message: 'You have hit a Gemini free-tier limit. Wait a minute and try again. Long videos may not fit within it.',
    };
  }
  if (lower.includes('token') && (lower.includes('exceed') || lower.includes('limit'))) {
    return { code: 'too_long', message: 'This video is too long for Gemini to process in one go.' };
  }
  if (status === 403) {
    return { code: 'invalid_key', message: 'Your API key does not have access to this model. Try another in settings.' };
  }
  if (lower.includes('video') || lower.includes('file_uri') || lower.includes('fileuri') || lower.includes('youtube')) {
    return { code: 'unavailable', message: 'Gemini cannot open this video. It may be private, unlisted or restricted.' };
  }
  if (status === 503) {
    return { code: 'overloaded', message: 'Gemini is very busy right now. Try again in a minute.' };
  }
  if (status >= 500) {
    return { code: 'server', message: 'Gemini is having trouble right now. Try again shortly.' };
  }
  return { code: 'rejected', message: `Gemini rejected the request: ${message || `HTTP ${status}`}` };
}

function blocked(): GeminiOutcome {
  return fail('blocked', 'Gemini declined to answer this video because of its content or copyright filters.');
}

function fail(code: AnswerError['code'], message: string): GeminiOutcome {
  return { ok: false, error: { code, message } };
}
