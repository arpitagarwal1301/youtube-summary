import type { VideoRef } from '../shared/types';
import { DEFAULT_SELECTORS, type SelectorName } from '../shared/remote';
import { parseClock, parseVideoId } from '../shared/video';

const TITLE_SELECTORS = ['#video-title', 'h3 [title]', 'h3', '[class*="title"]'];
const CHANNEL_SELECTORS = ['ytd-channel-name #text', 'a[href^="/@"]', 'a[href^="/channel/"]', 'a[href^="/c/"]'];
const CHANNEL_AREA_SELECTOR = '[class*="avatar" i], a[href^="/@"], a[href^="/channel/"], a[href^="/c/"]';

/** YouTube renames its elements from time to time, so these can be corrected by the remote settings file. */
let selectors: Record<SelectorName, string> = { ...DEFAULT_SELECTORS };

/** Takes corrected selectors, keeping the built-in one wherever a new one is not valid CSS. */
export function setSelectors(next: Partial<Record<string, string>>): void {
  const probe = document.createDocumentFragment();
  for (const name of Object.keys(DEFAULT_SELECTORS) as SelectorName[]) {
    const value = next[name];
    if (!value) continue;
    try {
      probe.querySelector(value);
      selectors[name] = value;
    } catch {
      selectors[name] = DEFAULT_SELECTORS[name];
    }
  }
}

export function selector(name: SelectorName): string {
  return selectors[name];
}

export interface FoundVideo {
  video: VideoRef;
  thumbnail: Element;
}

/** Finds the video card under an element. YouTube renames its classes often, so this leans on video links. */
export function findVideoAt(target: Element): FoundVideo | null {
  if (target.closest(selectors.ad)) return null;

  const card = target.closest(selectors.card);
  const thumbnail = card ? findThumbnailLink(card) : standaloneThumbnail(target);
  if (!thumbnail) return null;

  const videoId = parseVideoId(thumbnail.getAttribute('href') ?? '');
  if (!videoId) return null;

  const root = card ?? thumbnail;
  const video: VideoRef = {
    videoId,
    title: readTitle(root, thumbnail),
    channel: readFirstText(root, CHANNEL_SELECTORS),
  };
  if (thumbnail.getAttribute('href')?.startsWith('/shorts/')) video.isShort = true;
  const badges = readLeafTexts(thumbnail);
  const duration = badges.map(parseClock).find((seconds) => seconds !== undefined);
  if (duration !== undefined) video.durationSeconds = duration;
  // A duration means it has finished, whatever else the card shows.
  else if (hasLiveMarker(root, badges)) video.isLive = true;

  return { video, thumbnail };
}

function hasLiveMarker(root: Element, thumbnailTexts: string[]): boolean {
  if (thumbnailTexts.some((text) => /^live( now)?$/i.test(text))) return true;
  // A channel avatar can show its own LIVE ring on a card for a normal video.
  return [...root.querySelectorAll(selectors.liveMarker)].some((marker) => !marker.closest(CHANNEL_AREA_SELECTOR));
}

/** Videos whose thumbnails are at least half on screen, top of the page first. */
export function findVisibleVideos(doc: Document, viewportWidth: number, viewportHeight: number): FoundVideo[] {
  const found = new Map<string, FoundVideo>();
  for (const card of doc.querySelectorAll(selectors.card)) {
    if (!isMostlyOnScreen(card.getBoundingClientRect(), viewportWidth, viewportHeight, 0)) continue;
    const video = findVideoAt(card);
    if (!video || found.has(video.video.videoId)) continue;
    if (isMostlyOnScreen(video.thumbnail.getBoundingClientRect(), viewportWidth, viewportHeight, 0.5)) {
      found.set(video.video.videoId, video);
    }
  }
  return [...found.values()];
}

function isMostlyOnScreen(rect: DOMRect, viewportWidth: number, viewportHeight: number, share: number): boolean {
  if (rect.width === 0 || rect.height === 0) return false;
  const visibleWidth = Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0);
  const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
  return visibleWidth > 0 && visibleHeight > 0 && visibleWidth * visibleHeight >= rect.width * rect.height * share;
}

function findThumbnailLink(card: Element): Element | null {
  for (const link of card.querySelectorAll('a[href]')) {
    if (parseVideoId(link.getAttribute('href') ?? '') && link.querySelector(selectors.thumbnailImage)) return link;
  }
  return null;
}

/** Also covers the inline preview player, which YouTube places outside the card. */
function standaloneThumbnail(target: Element): Element | null {
  const link = target.closest('a[href]');
  if (!link || !parseVideoId(link.getAttribute('href') ?? '')) return null;
  return link.querySelector(selectors.thumbnailImage) ? link : null;
}

function readTitle(root: Element, thumbnail: Element): string {
  for (const selector of TITLE_SELECTORS) {
    for (const element of root.querySelectorAll(selector)) {
      if (thumbnail.contains(element)) continue;
      const text = element.getAttribute('title')?.trim() || element.textContent?.trim();
      if (text) return text;
    }
  }
  return thumbnail.getAttribute('aria-label')?.trim() || thumbnail.querySelector('img')?.alt?.trim() || '';
}

function readFirstText(root: Element, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      const text = element.textContent?.trim();
      if (text) return text;
    }
  }
  return undefined;
}

function readLeafTexts(root: Element): string[] {
  const texts: string[] = [];
  for (const element of root.querySelectorAll('*')) {
    if (element.childElementCount > 0) continue;
    const text = element.textContent?.trim();
    if (text) texts.push(text);
  }
  return texts;
}

/** Details of the video open on a watch or Shorts page, or null on any other page. */
export function readCurrentPageVideo(doc: Document, href: string): VideoRef | null {
  const videoId = parseVideoId(href);
  if (!videoId) return null;

  const heading = doc.querySelector(selectors.watchHeading);
  const video: VideoRef = {
    videoId,
    title: heading?.textContent?.trim() || doc.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '').trim(),
    channel: doc.querySelector(selectors.watchChannel)?.textContent?.trim(),
  };
  if (new URL(href, 'https://www.youtube.com').pathname.startsWith('/shorts/')) video.isShort = true;

  // While an advert plays, the player reports the advert's length, not the video's.
  const player = doc.querySelector<HTMLVideoElement>(selectors.mainVideo);
  if (player && !doc.querySelector(selectors.adPlaying)) {
    if (player.duration === Infinity) video.isLive = true;
    else if (player.duration > 0) video.durationSeconds = Math.round(player.duration);
  }
  return video;
}

/** Where the button for the open video goes: beside the title on a watch page, beside the player on a Shorts page. */
export function findPageAnchor(doc: Document, pathname: string): { element: Element; kind: 'watch' | 'shorts' } | null {
  if (pathname === '/watch') {
    const element = [...doc.querySelectorAll(selectors.watchTitle)].find(isLaidOut);
    return element ? { element, kind: 'watch' } : null;
  }
  if (pathname.startsWith('/shorts/')) {
    const element = [...doc.querySelectorAll(selectors.shortsPlayer)].find(isLaidOut);
    return element ? { element, kind: 'shorts' } : null;
  }
  return null;
}

/**
 * The free space at the left end of YouTube's row of video actions, between the channel and the first action button.
 * Returns where that first button starts and the row's middle, or null if the row is not there or too crowded.
 */
export function findActionsSpot(doc: Document, width: number): { right: number; middle: number } | null {
  const row = [...doc.querySelectorAll(selectors.watchActions)].find(isLaidOut);
  if (!row) return null;
  const buttons = [...row.querySelectorAll('button')].map((button) => button.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
  if (buttons.length === 0) return null;
  const first = buttons.reduce((leftmost, rect) => (rect.left < leftmost.left ? rect : leftmost));
  const owner = [...doc.querySelectorAll(selectors.watchOwner)].find(isLaidOut)?.getBoundingClientRect();
  const right = first.left - ACTIONS_GAP;
  if (owner && right - width < owner.right + ACTIONS_GAP && owner.bottom > first.top && owner.top < first.bottom) return null;
  return { right, middle: first.top + first.height / 2 };
}
const ACTIONS_GAP = 12;

/** Where Know It's button goes in YouTube's top bar: right of the microphone, or of the search box if there is none. */
export function findMastheadSpot(doc: Document, size: number): { left: number; top: number } | null {
  const after = [...doc.querySelectorAll(selectors.mastheadMic)].find(isLaidOut) ?? [...doc.querySelectorAll(selectors.mastheadSearch)].find(isLaidOut);
  if (!after) return null;
  const rect = after.getBoundingClientRect();
  if (rect.bottom <= 0) return null;
  const left = rect.right + MASTHEAD_GAP;
  const end = [...doc.querySelectorAll(selectors.mastheadEnd)].find(isLaidOut)?.getBoundingClientRect();
  if (end && left + size + MASTHEAD_GAP > end.left) return null;
  return { left, top: rect.top + rect.height / 2 - size / 2 };
}
const MASTHEAD_GAP = 8;

function isLaidOut(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Moves the open video to a moment, if it is the main player on this page. Returns false if there is none. */
export function seekPageVideo(doc: Document, seconds: number): boolean {
  const player = doc.querySelector<HTMLVideoElement>(selectors.mainVideo);
  if (!player || doc.querySelector(selectors.adPlaying)) return false;
  player.currentTime = seconds;
  void player.play().catch(() => undefined);
  return true;
}
