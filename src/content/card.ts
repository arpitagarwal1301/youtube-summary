import type { VideoRef } from '../shared/types';
import { parseClock, parseVideoId } from '../shared/video';

const CARD_SELECTOR = [
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
].join(',');

const AD_SELECTOR = 'ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-video-renderer';
const THUMBNAIL_IMAGE = 'img, yt-image, yt-thumbnail-view-model, ytd-thumbnail';
const TITLE_SELECTORS = ['#video-title', 'h3 [title]', 'h3', '[class*="title"]'];
const CHANNEL_SELECTORS = ['ytd-channel-name #text', 'a[href^="/@"]', 'a[href^="/channel/"]', 'a[href^="/c/"]'];
const LIVE_MARKER_SELECTOR = 'ytd-thumbnail[is-live-video], badge-shape[class*="BadgeShapeLive"], badge-shape[aria-label="LIVE" i]';
const CHANNEL_AREA_SELECTOR = '[class*="avatar" i], a[href^="/@"], a[href^="/channel/"], a[href^="/c/"]';

export interface FoundVideo {
  video: VideoRef;
  thumbnail: Element;
}

/** Finds the video card under an element. YouTube renames its classes often, so this leans on video links. */
export function findVideoAt(target: Element): FoundVideo | null {
  if (target.closest(AD_SELECTOR)) return null;

  const card = target.closest(CARD_SELECTOR);
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
  return [...root.querySelectorAll(LIVE_MARKER_SELECTOR)].some((marker) => !marker.closest(CHANNEL_AREA_SELECTOR));
}

/** Videos whose thumbnails are at least half on screen, top of the page first. */
export function findVisibleVideos(doc: Document, viewportWidth: number, viewportHeight: number): FoundVideo[] {
  const found = new Map<string, FoundVideo>();
  for (const card of doc.querySelectorAll(CARD_SELECTOR)) {
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
    if (parseVideoId(link.getAttribute('href') ?? '') && link.querySelector(THUMBNAIL_IMAGE)) return link;
  }
  return null;
}

/** Also covers the inline preview player, which YouTube places outside the card. */
function standaloneThumbnail(target: Element): Element | null {
  const link = target.closest('a[href]');
  if (!link || !parseVideoId(link.getAttribute('href') ?? '')) return null;
  return link.querySelector(THUMBNAIL_IMAGE) ? link : null;
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

  const heading = doc.querySelector('h1.ytd-watch-metadata, ytd-watch-metadata h1, h1.title');
  const video: VideoRef = {
    videoId,
    title: heading?.textContent?.trim() || doc.title.replace(/ - YouTube$/, '').trim(),
    channel: doc.querySelector('#owner ytd-channel-name a, ytd-video-owner-renderer ytd-channel-name a')?.textContent?.trim(),
  };

  const player = doc.querySelector<HTMLVideoElement>('video.html5-main-video');
  if (player) {
    if (player.duration === Infinity) video.isLive = true;
    else if (player.duration > 0) video.durationSeconds = Math.round(player.duration);
  }
  return video;
}
