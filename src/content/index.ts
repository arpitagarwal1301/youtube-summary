import type { AnswerResult, RequestMessage, RequestReply, StatusReply, TabMessage, VideoRef } from '../shared/types';
import { parseVideoId } from '../shared/video';
import { findVideoAt, findVisibleVideos, readCurrentPageVideo, type FoundVideo } from './card';
import { createSparkleIcon } from './icon';
import { PopoverView, element } from './popover';
import { PREFETCH_BACKOFF_MS, isBrowsingPage, pickNextPrefetch, type VideoStatus } from './prefetch';
import { STYLES } from './styles';

const MIN_THUMBNAIL_WIDTH = 100;
const BUTTON_INSET = 8;
const POPOVER_GAP = 8;
const VIEWPORT_MARGIN = 8;
const SCAN_INTERVAL_MS = 1500;
/** Another tab has the one background slot, so check again soon. */
const BUSY_RETRY_MS = 5000;
/** Turned off or over budget. The setting can change, so check again now and then. */
const OFF_RETRY_MS = 60_000;
/** Longer than the service worker keeps a job, in case its reply never arrives. */
const IN_FLIGHT_LIMIT_MS = 5 * 60 * 1000;

const BUTTON_LABELS: Record<VideoStatus | 'idle', string> = {
  idle: 'Know it',
  loading: 'Loading…',
  ready: 'See answer',
};

declare global {
  interface Window {
    __knowItLoaded?: boolean;
  }
}

function start(): void {
  // The UI lives in one shadow root on the page, never inside YouTube's own elements.
  // YouTube re-renders its cards constantly, and this way nothing has to be re-attached.
  const host = document.createElement('know-it-root');
  const shadow = host.attachShadow({ mode: 'open' });
  const root = element('div', 'root');
  const style = element('style');
  style.textContent = STYLES;

  const markerLayer = element('div');
  const button = element('button', 'know-it');
  button.type = 'button';
  const buttonLabel = element('span');
  button.append(createSparkleIcon('sparkle'), element('span', 'spinner small'), buttonLabel);
  const popover = element('div', 'popover');
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Video answer');
  root.append(markerLayer, button, popover);
  shadow.append(style, root);
  document.documentElement.append(host);

  let hovered: FoundVideo | null = null;
  let openVideo: VideoRef | null = null;
  let anchor: Element | null = null;

  const statuses = new Map<string, VideoStatus>();
  const visible = new Map<string, FoundVideo>();
  const markers = new Map<string, HTMLButtonElement>();
  const askedStatus = new Set<string>();

  const firstSeen = new Map<string, number>();
  const failedPrefetch = new Set<string>();
  let prefetchInFlight: { videoId: string; since: number } | null = null;
  let prefetchPausedUntil = 0;

  const view = new PopoverView(popover, {
    close: closePopover,
    retry: (force) => {
      if (openVideo) void requestAnswer(openVideo, force);
    },
    openSettings: () => send({ type: 'OPEN_OPTIONS' }).catch(() => undefined),
  });

  function send<T = RequestReply>(message: RequestMessage): Promise<T | undefined> {
    return chrome.runtime.sendMessage(message);
  }

  function applyTheme(): void {
    root.classList.toggle('dark', document.documentElement.hasAttribute('dark'));
  }

  function setStatus(videoId: string, status: VideoStatus | null): void {
    if (status) statuses.set(videoId, status);
    else statuses.delete(videoId);
    placeButton();
    renderMarkers();
  }

  function isStillThisVideo(found: FoundVideo): boolean {
    // YouTube reuses card elements for other videos as the page changes.
    return found.thumbnail.isConnected && parseVideoId(found.thumbnail.getAttribute('href') ?? '') === found.video.videoId;
  }

  function placeButton(): void {
    if (!hovered || !isStillThisVideo(hovered)) {
      button.classList.remove('visible');
      return;
    }
    const rect = hovered.thumbnail.getBoundingClientRect();
    if (rect.width < MIN_THUMBNAIL_WIDTH || rect.bottom < 0 || rect.top > window.innerHeight) {
      button.classList.remove('visible');
      return;
    }
    const status = statuses.get(hovered.video.videoId) ?? 'idle';
    button.dataset.status = status;
    buttonLabel.textContent = BUTTON_LABELS[status];
    button.setAttribute('aria-label', status === 'idle' ? 'Know it: answer this headline' : BUTTON_LABELS[status]);
    button.style.left = `${rect.left + BUTTON_INSET}px`;
    button.style.top = `${rect.top + BUTTON_INSET}px`;
    button.classList.add('visible');
  }

  /** Small badges that show a video's state when the pointer is somewhere else. */
  function renderMarkers(): void {
    const shown = new Set<string>();
    const hoveredId = button.classList.contains('visible') ? hovered?.video.videoId : undefined;

    for (const [videoId, found] of visible) {
      const status = statuses.get(videoId);
      if (!status || videoId === hoveredId || !isStillThisVideo(found)) continue;
      const rect = found.thumbnail.getBoundingClientRect();
      if (rect.width < MIN_THUMBNAIL_WIDTH || rect.bottom < 0 || rect.top > window.innerHeight) continue;

      let marker = markers.get(videoId);
      if (!marker) {
        marker = createMarker(videoId);
        markers.set(videoId, marker);
        markerLayer.append(marker);
      }
      marker.dataset.status = status;
      const label = status === 'loading' ? 'Getting the answer…' : 'Answer ready. Click to see it.';
      marker.title = label;
      marker.setAttribute('aria-label', label);
      marker.style.left = `${rect.left + BUTTON_INSET}px`;
      marker.style.top = `${rect.top + BUTTON_INSET}px`;
      shown.add(videoId);
    }

    for (const [videoId, marker] of markers) {
      if (shown.has(videoId)) continue;
      marker.remove();
      markers.delete(videoId);
    }
  }

  function createMarker(videoId: string): HTMLButtonElement {
    const marker = element('button', 'marker');
    marker.type = 'button';
    marker.append(createSparkleIcon('sparkle'), element('span', 'spinner small'));
    marker.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const found = visible.get(videoId);
      if (found) openPopover(found.video, found.thumbnail);
    });
    return marker;
  }

  function placePopover(): void {
    if (!popover.classList.contains('visible')) return;
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;

    let left = maxLeft;
    let top = VIEWPORT_MARGIN;
    if (anchor?.isConnected) {
      const rect = anchor.getBoundingClientRect();
      // Beside the thumbnail where it fits, so the headline stays readable.
      if (rect.right + POPOVER_GAP + width <= window.innerWidth) left = rect.right + POPOVER_GAP;
      else if (rect.left - POPOVER_GAP - width >= 0) left = rect.left - POPOVER_GAP - width;
      else left = rect.left;
      top = rect.top;
    }
    popover.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft))}px`;
    popover.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop))}px`;
  }

  function openPopover(video: VideoRef, thumbnail: Element | null): void {
    openVideo = video;
    anchor = thumbnail;
    applyTheme();
    popover.classList.add('visible');
    void requestAnswer(video, false);
  }

  function closePopover(): void {
    view.stopTimer();
    popover.classList.remove('visible');
    openVideo = null;
    anchor = null;
  }

  async function requestAnswer(video: VideoRef, force: boolean): Promise<void> {
    view.showLoading(video.title);
    placePopover();
    let reply: RequestReply | undefined;
    try {
      reply = await send({ type: 'ANSWER_REQUEST', video, force });
    } catch {
      // The extension was reloaded after this page opened, which clears chrome.runtime.id.
      // Otherwise the service worker was stopped mid-reply, so the same request is safe to send again.
      if (chrome.runtime?.id) reply = await send<RequestReply>({ type: 'ANSWER_REQUEST', video, force }).catch(() => undefined);
      if (!reply) {
        const message = chrome.runtime?.id
          ? 'Could not reach the extension. Try again.'
          : 'The extension was updated. Refresh this page to use it.';
        showResult(video, { ok: false, error: { code: chrome.runtime?.id ? 'server' : 'rejected', message } });
        return;
      }
    }
    if (!reply) return;
    if (reply.pending) {
      setStatus(video.videoId, 'loading');
    } else if ('result' in reply) {
      setStatus(video.videoId, reply.result.ok ? 'ready' : null);
      if (openVideo?.videoId === video.videoId) showResult(video, reply.result);
    }
  }

  function showResult(video: VideoRef, result: AnswerResult): void {
    if (result.ok) view.showAnswer(video.title, video.videoId, result.answer, result.fromCache);
    else view.showError(video.title, result.error);
    placePopover();
  }

  function clearPrefetchInFlight(videoId: string): void {
    if (prefetchInFlight?.videoId === videoId) prefetchInFlight = null;
  }

  async function startNextPrefetch(now: number): Promise<void> {
    if (prefetchInFlight && now - prefetchInFlight.since > IN_FLIGHT_LIMIT_MS) prefetchInFlight = null;
    if (prefetchInFlight || now < prefetchPausedUntil || !isBrowsingPage(location.pathname)) return;

    const next = pickNextPrefetch([...visible.values()].map((found) => found.video), {
      statuses,
      failed: failedPrefetch,
      firstSeen,
      hoveredId: hovered?.video.videoId,
      now,
    });
    if (!next) return;

    prefetchInFlight = { videoId: next.videoId, since: now };
    const reply = await send({ type: 'ANSWER_REQUEST', video: next, background: true }).catch(() => undefined);

    if (reply?.pending) {
      // Unless its answer has already arrived while this reply was on its way.
      if (prefetchInFlight?.videoId === next.videoId) setStatus(next.videoId, 'loading');
      return;
    }
    clearPrefetchInFlight(next.videoId);
    if (!reply) {
      prefetchPausedUntil = now + OFF_RETRY_MS;
    } else if ('result' in reply) {
      if (reply.result.ok) setStatus(next.videoId, 'ready');
      else failedPrefetch.add(next.videoId);
    } else {
      prefetchPausedUntil = now + (reply.skipped === 'busy' ? BUSY_RETRY_MS : OFF_RETRY_MS);
    }
  }

  async function refreshStatuses(): Promise<void> {
    // Anything not yet asked about, plus anything still loading, in case its reply went to another tab.
    const videoIds = [...visible.keys()].filter((videoId) => !statuses.has(videoId) && !askedStatus.has(videoId));
    for (const [videoId, status] of statuses) {
      if (status === 'loading' && !videoIds.includes(videoId)) videoIds.push(videoId);
    }
    if (videoIds.length === 0) return;

    const reply = await send<StatusReply>({ type: 'STATUS_REQUEST', videoIds }).catch(() => undefined);
    if (!reply) return;

    const ready = new Set(reply.ready);
    const loading = new Set(reply.loading);
    for (const videoId of videoIds) {
      askedStatus.add(videoId);
      if (loading.has(videoId)) statuses.set(videoId, 'loading');
      else if (ready.has(videoId)) statuses.set(videoId, 'ready');
      else if (statuses.get(videoId) === 'loading') statuses.delete(videoId);
      if (!loading.has(videoId)) clearPrefetchInFlight(videoId);
    }
    placeButton();
    renderMarkers();
  }

  let scanning = false;
  async function scan(): Promise<void> {
    if (!chrome.runtime?.id) {
      window.clearInterval(scanTimer);
      return;
    }
    if (document.hidden || scanning) return;
    scanning = true;
    try {
      const now = Date.now();
      const found = findVisibleVideos(document, window.innerWidth, window.innerHeight);
      const ids = new Set(found.map((item) => item.video.videoId));
      for (const videoId of firstSeen.keys()) {
        if (!ids.has(videoId)) firstSeen.delete(videoId);
      }
      visible.clear();
      for (const item of found) {
        visible.set(item.video.videoId, item);
        if (!firstSeen.has(item.video.videoId)) firstSeen.set(item.video.videoId, now);
      }
      renderMarkers();
      await refreshStatuses();
      await startNextPrefetch(now);
    } finally {
      scanning = false;
    }
  }
  const scanTimer = window.setInterval(() => void scan(), SCAN_INTERVAL_MS);

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (hovered) openPopover(hovered.video, hovered.thumbnail);
  });

  document.addEventListener(
    'mouseover',
    (event) => {
      if (event.composedPath().includes(host)) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      // The preview player covers the card it belongs to, and has fewer details to read.
      if (target.closest('ytd-video-preview')) return;

      const found = findVideoAt(target);
      if (found) {
        hovered = found;
        applyTheme();
      } else if (hovered && !isInside(hovered.thumbnail, event.clientX, event.clientY)) {
        // YouTube's preview player covers the thumbnail, so only hide once the pointer has really left.
        hovered = null;
      }
      placeButton();
      renderMarkers();
    },
    { capture: true, passive: true },
  );

  let frame = 0;
  const reposition = (): void => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      placeButton();
      placePopover();
      renderMarkers();
    });
  };
  window.addEventListener('scroll', reposition, { capture: true, passive: true });
  window.addEventListener('resize', reposition, { passive: true });

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (popover.classList.contains('visible') && !event.composedPath().includes(host)) closePopover();
    },
    { capture: true, passive: true },
  );

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && popover.classList.contains('visible')) closePopover();
  });

  // YouTube changes page without a reload, so nothing from the last page should linger.
  document.addEventListener('yt-navigate-start', () => {
    closePopover();
    hovered = null;
    visible.clear();
    firstSeen.clear();
    placeButton();
    renderMarkers();
  });

  chrome.runtime.onMessage.addListener((message: TabMessage) => {
    if (message.type === 'OPEN_FOR_PAGE') {
      const video = readCurrentPageVideo(document, location.href);
      if (video) openPopover(video, null);
    } else if (message.type === 'ANSWER_READY') {
      clearPrefetchInFlight(message.videoId);
      if (message.result.ok) {
        setStatus(message.videoId, 'ready');
      } else {
        setStatus(message.videoId, null);
        failedPrefetch.add(message.videoId);
        if (message.result.error.code === 'rate_limited' || message.result.error.code === 'overloaded') {
          prefetchPausedUntil = Date.now() + PREFETCH_BACKOFF_MS;
        }
      }
      if (openVideo?.videoId === message.videoId) showResult(openVideo, message.result);
    }
  });

  void scan();
}

function isInside(element: Element, x: number, y: number): boolean {
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// The toolbar icon can inject this script into a tab that already has it.
if (!window.__knowItLoaded) {
  window.__knowItLoaded = true;
  start();
}
