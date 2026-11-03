export const CATEGORIES = [
  'movie_tv',
  'music',
  'finance',
  'news',
  'product_tech',
  'real_estate',
  'education',
  'how_to',
  'sports',
  'gaming',
  'vlog',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export interface VideoRef {
  videoId: string;
  title: string;
  channel?: string;
  durationSeconds?: number;
  isLive?: boolean;
  isShort?: boolean;
  description?: string;
  keywords?: string[];
}

export interface VideoAnswer {
  category: Category;
  question: string;
  answer: string;
  keyPoints: string[];
  summary: string[];
  confidence: Confidence;
  titleDelivers: boolean;
  nameIsGuess?: boolean;
  evidence?: { seconds: number; note: string };
}

export type ErrorCode =
  | 'no_key'
  | 'invalid_key'
  | 'rate_limited'
  | 'overloaded'
  | 'daily_limit'
  | 'too_long'
  | 'unavailable'
  | 'blocked'
  | 'bad_response'
  | 'network'
  | 'timeout'
  | 'server'
  | 'rejected';

export interface AnswerError {
  code: ErrorCode;
  message: string;
}

export type AnswerResult =
  | { ok: true; answer: VideoAnswer; fromCache: boolean }
  | { ok: false; error: AnswerError };

export type GeminiOutcome =
  | { ok: true; answer: VideoAnswer; videoTokens: number; modelVersion?: string }
  | { ok: false; error: AnswerError };

export type AnswerLanguage = 'english' | 'video';

export interface GeminiJob {
  video: VideoRef;
  apiKey: string;
  model: string;
  language: AnswerLanguage;
}

/** Content script to service worker. */
export type RequestMessage =
  | { type: 'ANSWER_REQUEST'; video: VideoRef; force?: boolean; background?: boolean }
  | { type: 'STATUS_REQUEST'; videoIds: string[] }
  | { type: 'OPEN_OPTIONS' };

/** Why a background request was not started. These are never shown to the user. */
export type SkipReason = 'off' | 'busy' | 'budget';

/** The service worker's immediate reply to ANSWER_REQUEST. */
export type RequestReply =
  | { pending: true }
  | { pending: false; result: AnswerResult }
  | { pending: false; skipped: SkipReason };

/** The service worker's reply to STATUS_REQUEST. */
export interface StatusReply {
  ready: string[];
  loading: string[];
}

/** Service worker to offscreen document. */
export interface RunGeminiMessage {
  type: 'RUN_GEMINI';
  jobKey: string;
  job: GeminiJob;
}

/** Offscreen document to service worker. */
export interface GeminiDoneMessage {
  type: 'GEMINI_DONE';
  jobKey: string;
  outcome: GeminiOutcome;
}

/** Service worker to content script. */
export type TabMessage =
  | { type: 'ANSWER_READY'; videoId: string; result: AnswerResult }
  | { type: 'OPEN_FOR_PAGE' };
