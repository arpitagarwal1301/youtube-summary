/** Replaced at build time, so end-to-end tests can serve their own copy. */
declare const __CONFIG_URL__: string;

/**
 * Values that can be corrected without releasing a new version: a small JSON file in the project's GitHub
 * repository, read at most once a day. It holds data only. Nothing in it is ever run as code, every value is
 * checked before use, and anything missing or invalid falls back to what is built in here.
 */
export interface RemoteConfig {
  models: { auto: string; fallback: string };
  /** CSS selectors for the parts of YouTube's pages the extension reads. YouTube renames these from time to time. */
  selectors: Record<SelectorName, string>;
  links: Record<LinkName, string>;
  /** A short line shown in the toolbar panel, for example about a known problem. */
  notice: { id: string; text: string; url?: string } | null;
}

export const DEFAULT_SELECTORS = {
  card: [
    'yt-lockup-view-model',
    'ytm-shorts-lockup-view-model',
    'ytm-shorts-lockup-view-model-v2',
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-playlist-panel-video-renderer',
    'ytd-reel-item-renderer',
  ].join(','),
  ad: 'ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-video-renderer',
  thumbnailImage: 'img, yt-image, yt-thumbnail-view-model, ytd-thumbnail',
  liveMarker: 'ytd-thumbnail[is-live-video], badge-shape[class*="BadgeShapeLive"], badge-shape[aria-label="LIVE" i]',
  preview: 'ytd-video-preview',
  /** The block holding a watch page's title, where the page's own button sits. */
  watchTitle: 'ytd-watch-metadata #title, #above-the-fold #title',
  watchHeading: 'h1.ytd-watch-metadata, ytd-watch-metadata h1, h1.title',
  /** The row with Like, Share and YouTube's own Ask button. The page's button goes at its left end. */
  watchActions: 'ytd-watch-metadata #actions',
  /** The channel and Subscribe button, on the same row, which the page's button must not cover. */
  watchOwner: 'ytd-watch-metadata #owner',
  watchChannel: '#owner ytd-channel-name a, ytd-video-owner-renderer ytd-channel-name a',
  /** YouTube's top bar: Know It's own button goes just right of the microphone, before the bar's right-hand buttons. */
  mastheadMic: 'ytd-masthead #voice-search-button',
  mastheadSearch: 'ytd-masthead #center',
  mastheadEnd: 'ytd-masthead #end',
  mainVideo: '#movie_player video.html5-main-video, #shorts-player video.html5-main-video, video.html5-main-video',
  shortsPlayer: 'ytd-reel-video-renderer[is-active] #shorts-player, #shorts-player, ytd-reel-video-renderer[is-active]',
  adPlaying: '.html5-video-player.ad-showing, .html5-video-player.ad-interrupting',
} as const;
export type SelectorName = keyof typeof DEFAULT_SELECTORS;

const REPO = 'https://github.com/arpitagarwal1301/youtube-summary';
const SITE = 'https://getknowit.github.io';
export const DEFAULT_LINKS = {
  github: REPO,
  whatsNew: `${REPO}/releases`,
  sponsor: 'https://github.com/sponsors/arpitagarwal1301',
  feedback: 'mailto:arpitvinshu@gmail.com?subject=Know%20It%20feedback',
  /** Added to answers that are copied, so people who see one can find the extension. */
  share: SITE,
  privacy: `${SITE}/privacy`,
  getKey: 'https://aistudio.google.com/apikey',
} as const;
export type LinkName = keyof typeof DEFAULT_LINKS;

export const DEFAULT_CONFIG: RemoteConfig = {
  models: { auto: 'gemini-flash-lite-latest', fallback: 'gemini-3.1-flash-lite' },
  selectors: { ...DEFAULT_SELECTORS },
  links: { ...DEFAULT_LINKS },
  notice: null,
};

/** A changed link must still lead somewhere the project controls, or to Google's own pages. */
const LINK_HOSTS = ['github.com', 'getknowit.github.io', 'chromewebstore.google.com', 'aistudio.google.com'];
const MODEL_NAME = /^[a-z0-9][a-z0-9.-]{2,59}$/;
const MAX_SELECTOR_LENGTH = 800;
const MAX_NOTICE_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validLink(value: unknown, allowMail: boolean): value is string {
  if (typeof value !== 'string' || value.length > 300) return false;
  try {
    const url = new URL(value);
    if (url.protocol === 'mailto:') return allowMail;
    return url.protocol === 'https:' && LINK_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

/** Selectors are only ever passed to querySelector. This keeps out anything that could not be one. */
function validSelector(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_SELECTOR_LENGTH && !/[{};<>]/.test(value);
}

/** Builds a full config from whatever the file contained, keeping the built-in value wherever the file's is missing or invalid. */
export function parseRemoteConfig(raw: unknown): RemoteConfig {
  const config: RemoteConfig = {
    models: { ...DEFAULT_CONFIG.models },
    selectors: { ...DEFAULT_CONFIG.selectors },
    links: { ...DEFAULT_CONFIG.links },
    notice: null,
  };
  if (!isRecord(raw)) return config;

  if (isRecord(raw.models)) {
    for (const name of ['auto', 'fallback'] as const) {
      const value = raw.models[name];
      if (typeof value === 'string' && MODEL_NAME.test(value)) config.models[name] = value;
    }
  }
  if (isRecord(raw.selectors)) {
    for (const name of Object.keys(DEFAULT_SELECTORS) as SelectorName[]) {
      const value = raw.selectors[name];
      if (validSelector(value)) config.selectors[name] = value;
    }
  }
  if (isRecord(raw.links)) {
    for (const name of Object.keys(DEFAULT_LINKS) as LinkName[]) {
      const value = raw.links[name];
      if (validLink(value, name === 'feedback')) config.links[name] = value;
    }
  }
  if (isRecord(raw.notice) && typeof raw.notice.id === 'string' && typeof raw.notice.text === 'string') {
    const text = raw.notice.text.trim().slice(0, MAX_NOTICE_LENGTH);
    const id = raw.notice.id.trim().slice(0, 40);
    if (id && text) config.notice = { id, text, ...(validLink(raw.notice.url, false) ? { url: raw.notice.url } : {}) };
  }
  return config;
}

const REMOTE_KEY = 'remote';
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

interface StoredRemote {
  checkedAt: number;
  ok: boolean;
  raw?: unknown;
}

/** The config as last fetched, or the built-in one. Never touches the network. */
export async function getRemoteConfig(): Promise<RemoteConfig> {
  const stored = await chrome.storage.local.get(REMOTE_KEY);
  return parseRemoteConfig((stored[REMOTE_KEY] as StoredRemote | undefined)?.raw);
}

/** Fetches the file if a day has passed since the last look. Returns true if what is stored changed. */
export async function refreshRemoteConfig(now = Date.now()): Promise<boolean> {
  const stored = await chrome.storage.local.get(REMOTE_KEY);
  const last = stored[REMOTE_KEY] as StoredRemote | undefined;
  if (last && now - last.checkedAt < (last.ok ? CHECK_EVERY_MS : RETRY_AFTER_MS)) return false;

  let raw: unknown;
  let ok = false;
  try {
    // No cookies or other details are sent: this is a plain request for a public file.
    const response = await fetch(__CONFIG_URL__, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.ok) {
      raw = await response.json();
      ok = isRecord(raw);
    }
  } catch {
    // Offline, blocked or not valid JSON. The last good copy stays in use.
  }
  const next: StoredRemote = ok ? { checkedAt: now, ok, raw } : { checkedAt: now, ok, raw: last?.raw };
  await chrome.storage.local.set({ [REMOTE_KEY]: next });
  return ok && JSON.stringify(raw) !== JSON.stringify(last?.raw);
}
