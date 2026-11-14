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
  | 'no_model'
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
  | { ok: true; answer: VideoAnswer; videoTokens: number; modelVersion?: string; video: VideoRef }
  | { ok: false; error: AnswerError }
  /** An automatic request that turned out not to qualify once the video's real details were known. */
  | { ok: false; skipped: true };

export type AnswerLanguage = 'english' | 'video';

/** Where a request came from: a thumbnail, the button on a video's own page, or opening a video with auto-answer on. */
export type RequestSource = 'thumbnail' | 'page' | 'auto';

export interface GeminiJob {
  video: VideoRef;
  apiKey: string;
  model: string;
  fallbackModel: string;
  language: AnswerLanguage;
  /** Automatic requests give up on anything longer than this, or of unknown length. */
  maxSeconds?: number;
}

/** What the page needs to know about the extension's state. It never includes the API key. */
export interface PageState {
  hasKey: boolean;
  autoAnswer: boolean;
  selectors: Record<string, string>;
  shareUrl: string;
  sponsorUrl: string;
}

/** Content script to service worker. */
export type RequestMessage =
  | { type: 'ANSWER_REQUEST'; video: VideoRef; source: RequestSource; force?: boolean; retry?: boolean }
  | { type: 'STATUS_REQUEST'; videoIds: string[] }
  | { type: 'GET_STATE' }
  | { type: 'SET_AUTO'; on: boolean }
  | { type: 'AUTO_OFFER_DONE' }
  | { type: 'MARK_SEEN'; videoId: string }
  | { type: 'OPEN_PANEL' }
  | { type: 'GET_SAVED_TODAY' };

/** Why an automatic request was not started. These are never shown to the user. */
export type SkipReason = 'off' | 'busy' | 'budget' | 'failed';

/** The service worker's immediate reply to ANSWER_REQUEST. */
export type RequestReply =
  | { pending: true; startedAt: number }
  | { pending: false; result: AnswerResult; offerAuto?: boolean }
  | { pending: false; skipped: SkipReason };

/** The service worker's reply to STATUS_REQUEST. */
export interface StatusReply {
  ready: string[];
  /** Video ID to the time its request started. */
  loading: Record<string, number>;
  failed: Record<string, AnswerError>;
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
  | { type: 'ANSWER_READY'; video: VideoRef; result: AnswerResult; source: RequestSource; offerAuto?: boolean }
  | { type: 'OPEN_ANSWER'; video: VideoRef }
  | { type: 'STATE_CHANGED'; state: PageState };

/** A tab's reply to ANSWER_READY: whether someone was there to see it. */
export interface ReadyReply {
  shown: boolean;
}
