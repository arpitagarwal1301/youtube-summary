import { CATEGORIES, CONFIDENCE_LEVELS, type Category, type Confidence, type VideoAnswer, type VideoRef } from './types';
import { parseClock } from './video';

/** Categories where the name of a work is usually the whole answer. */
const NAMED_CATEGORIES: Category[] = ['movie_tv', 'music'];

export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: [...CATEGORIES] },
    question: {
      type: 'string',
      description: 'The specific thing the headline makes a viewer want to know, as one short question.',
    },
    answer: {
      type: 'string',
      description: 'The direct answer as one sentence of at most 25 words, with no lead-up. Put **double asterisks** around the most important fact.',
    },
    keyPoints: {
      type: 'array',
      items: { type: 'string' },
      description: 'Two to four points of at most 15 words each that back up or complete the answer. Put **double asterisks** around the key name or number in each.',
    },
    summary: {
      type: 'array',
      items: { type: 'string' },
      description: 'Three to six short points covering the rest of the video, not repeating the key points. Put **double asterisks** around the key name or number in each.',
    },
    confidence: { type: 'string', enum: [...CONFIDENCE_LEVELS] },
    name: {
      type: 'string',
      description: 'Just the title of the film, show or song the answer names, with no year. Empty if it names none.',
    },
    titleDelivers: {
      type: 'boolean',
      description: 'False if the video does not actually deliver what its headline promises.',
    },
    evidenceTimestamp: {
      type: 'string',
      description: 'MM:SS of the moment that best backs up the answer, or H:MM:SS past one hour. Empty if there is no such moment.',
    },
    evidenceNote: {
      type: 'string',
      description: 'A few words on what happens at that moment. Empty if there is no timestamp.',
    },
  },
  required: ['category', 'question', 'answer', 'keyPoints', 'summary', 'confidence', 'name', 'titleDelivers', 'evidenceTimestamp', 'evidenceNote'],
} as const;

/** Validates model output. Returns null if it has no usable answer. */
export function parseAnswer(text: string, video: Partial<VideoRef> = {}): VideoAnswer | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;

  const answer = cleanString(data.answer);
  if (!answer) return null;

  const result: VideoAnswer = {
    category: oneOf(data.category, CATEGORIES, 'other' satisfies Category),
    question: cleanString(data.question),
    answer,
    keyPoints: cleanList(data.keyPoints),
    summary: cleanList(data.summary),
    confidence: oneOf(data.confidence, CONFIDENCE_LEVELS, 'low' satisfies Confidence),
    titleDelivers: data.titleDelivers !== false,
  };

  // In testing, with no name to go on, the model named a different wrong film on each try, always at
  // high confidence and even when told not to guess. So the name is checked here, not left to the model.
  const name = cleanString(data.name);
  if (name && NAMED_CATEGORIES.includes(result.category) && !isNameBackedByPage(name, video)) {
    result.nameIsGuess = true;
    result.confidence = 'low';
  }

  const durationSeconds = video.durationSeconds;
  const seconds = parseClock(cleanString(data.evidenceTimestamp));
  // The very start is what the model gives when it has no real moment in mind.
  const inRange = !!seconds && (durationSeconds === undefined || seconds <= durationSeconds);
  if (inRange) result.evidence = { seconds, note: cleanString(data.evidenceNote) };

  return result;
}

/** Ignores case, spacing and punctuation, so "Khiladi 786" matches "khiladi786". */
function isNameBackedByPage(name: string, video: Partial<VideoRef>): boolean {
  const page = [video.title, video.channel, video.description, ...(video.keywords ?? [])].join(' ');
  const needle = squash(name);
  return needle.length > 0 && squash(page).includes(needle);
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(cleanString).filter(Boolean) : [];
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
