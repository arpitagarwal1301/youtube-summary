import { shareText } from '../shared/share';
import type {
  AnswerError,
  AnswerResult,
  PageState,
  ReadyReply,
  RequestMessage,
  RequestReply,
  RequestSource,
  StatusReply,
  TabMessage,
  VideoAnswer,
  VideoRef,
} from '../shared/types';
import { AUTO_MAX_VIDEO_SECONDS } from '../shared/usage';
import { parseVideoId } from '../shared/video';
import { findActionsSpot, findMastheadSpot, findPageAnchor, findVideoAt, findVisibleVideos, readCurrentPageVideo, seekPageVideo, selector, setSelectors, type FoundVideo } from './card';
import { createSparkleIcon } from './icon';
import { PopoverView, appendHighlighted, element } from './popover';
import { STYLES } from './styles';

const MIN_THUMBNAIL_WIDTH = 100;
const BUTTON_INSET = 8;
const POPOVER_GAP = 8;
const VIEWPORT_MARGIN = 8;
const SCAN_INTERVAL_MS = 1500;
/** A saved answer comes back faster than this, so it opens without a flash of the loading state. */
const LOADING_DELAY_MS = 150;
/** Long enough that someone who opened a video by mistake has already left. */
const AUTO_DELAY_MS = 5000;
/** YouTube's Shorts player shows pause, mute, captions and its menu in a strip this tall at the top. */
const SHORTS_CONTROLS_HEIGHT = 64;
const SHORTS_INSET = 16;
const TOAST_MS = 10_000;
const TOAST_TICK_MS = 500;
const MAX_TOASTS = 3;
/** Errors that say nothing about the video, so they are not left marked on its thumbnail. */
const NOT_ABOUT_VIDEO: AnswerError['code'][] = ['no_key', 'daily_limit'];

type VideoStatus = 'loading' | 'ready' | 'failed';
interface Known {
  status: VideoStatus;
  startedAt?: number;
  error?: AnswerError;
}

const BUTTON_LABELS: Record<VideoStatus | 'idle', string> = {
  idle: 'Know it',
  loading: 'Loading…',
  ready: 'See answer',
  failed: "Didn't work",
};
const MARKER_LABELS: Record<VideoStatus, string> = {
  loading: 'Getting the answer…',
  ready: 'Answer ready. Click to see it.',
  failed: 'This one did not work. Click to see why.',
};

/**
 * Sent on the page by a newer copy of this script, as it starts. After an update, Chrome cuts the old copy off
 * from the extension but leaves it running on open tabs, so it has to clear itself away. DOM events reach every copy.
 */
const REPLACE_EVENT = 'know-it-replace';

/** The three icons a control can show. Its status decides which one is visible. */
function statusIcons(): Element[] {
  const failed = element('span', 'failed-mark', '!');
  failed.setAttribute('aria-hidden', 'true');
  return [createSparkleIcon('sparkle'), element('span', 'spinner small'), failed];
}

function start(): void {
  // The UI lives in one shadow root on the page, never inside YouTube's own elements.
  // YouTube re-renders its cards constantly, and this way nothing has to be re-attached.
  /** Ends every listener on the page and window when this copy stops. */
  const lifetime = new AbortController();
  const { signal } = lifetime;

  const host = document.createElement('know-it-root');
  const shadow = host.attachShadow({ mode: 'open' });
  const root = element('div', 'root');
  const style = element('style');
  style.textContent = STYLES;

  const markerLayer = element('div');
  const button = element('button', 'pill know-it');
  button.type = 'button';
  const buttonLabel = element('span');
  button.append(...statusIcons(), buttonLabel);

  const pageBar = element('div', 'pagebar');
  const pageButton = element('button', 'pill page-know');
  pageButton.type = 'button';
  const pageLabel = element('span');
  pageButton.append(...statusIcons(), pageLabel);
  const autoSwitch = element('button', 'auto');
  autoSwitch.type = 'button';
  autoSwitch.setAttribute('role', 'switch');
  autoSwitch.title = 'Answer every video you open, without a click';
  autoSwitch.append(element('span', undefined, 'Auto'), element('span', 'track'));
  pageBar.append(pageButton, autoSwitch);

  const popover = element('div', 'popover');
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Video answer');
  const toasts = element('div', 'toasts');
  toasts.setAttribute('aria-live', 'polite');
  // Today's answers, from YouTube's own top bar.
  const topButton = element('button', 'topbar-button');
  topButton.type = 'button';
  topButton.title = "Know It: today's answers";
  topButton.setAttribute('aria-label', "Know It: today's answers");
  topButton.setAttribute('aria-expanded', 'false');
  topButton.append(createSparkleIcon('sparkle'), element('span', 'dot'));
  const drawer = element('div', 'drawer');
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-label', "Know It: today's answers");
  let drawerTheme = '';

  root.append(markerLayer, button, pageBar, topButton, drawer, popover, toasts);
  shadow.append(style, root);
  document.documentElement.append(host);

  let pageState: PageState = { hasKey: true, autoAnswer: false, selectors: {}, shareUrl: '', sponsorUrl: '' };
  let hovered: FoundVideo | null = null;
  let openVideo: VideoRef | null = null;
  let openSource: RequestSource = 'thumbnail';
  let anchor: Element | null = null;
  /** The video whose click led to the setup steps, answered as soon as a key is saved. */
  let awaitingKey: string | null = null;
  /** The title block whose right edge has been kept clear for the page button. */
  let reserved: HTMLElement | null = null;
  /** The Shorts player the page's button sits in, if this is a Shorts page. */
  let pagePlayer: Element | null = null;

  const statuses = new Map<string, Known>();
  const visible = new Map<string, FoundVideo>();
  const markers = new Map<string, HTMLButtonElement>();
  const askedStatus = new Set<string>();
  const autoTried = new Set<string>();
  let autoTimer = 0;

  const view = new PopoverView(popover, {
    close: closePopover,
    retry: (force) => {
      if (openVideo) void requestAnswer(openVideo, force ? { force } : { retry: true });
    },
    openPanel: () => {
      const videoId = openVideo?.videoId;
      closePopover();
      if (!openDrawer(videoId)) void send({ type: 'OPEN_PANEL' }).catch(() => undefined);
    },
    copy: async (answer: VideoAnswer) => {
      if (!openVideo) return false;
      try {
        await navigator.clipboard.writeText(shareText(openVideo, answer, pageState.shareUrl));
        return true;
      } catch {
        return false;
      }
    },
    seek: (seconds) => currentPageId() === openVideo?.videoId && seekPageVideo(document, seconds),
    setAuto,
    sponsorUrl: () => pageState.sponsorUrl,
    savedToday: async () => (await send<number>({ type: 'GET_SAVED_TODAY' }).catch(() => 0)) ?? 0,
  });

  function send<T = RequestReply>(message: RequestMessage): Promise<T | undefined> {
    return chrome.runtime.sendMessage(message);
  }

  function currentPageId(): string | null {
    return parseVideoId(location.href);
  }

  function isDark(): boolean {
    return document.documentElement.hasAttribute('dark');
  }

  function applyTheme(): void {
    root.classList.toggle('dark', isDark());
  }

  function applyState(state: PageState | undefined): void {
    if (!state) return;
    pageState = state;
    setSelectors(state.selectors);
    renderPageBar();
    if (state.hasKey && awaitingKey && openVideo?.videoId === awaitingKey) {
      awaitingKey = null;
      void requestAnswer(openVideo, { retry: true });
    }
    scheduleAuto();
  }

  function setStatus(videoId: string, known: Known | null): void {
    if (known) statuses.set(videoId, known);
    else statuses.delete(videoId);
    render();
  }

  function render(): void {
    placeButton();
    renderMarkers();
    renderPageBar();
    placeTopButton();
  }

  // ---- The button in YouTube's top bar, and the list of today's answers it opens ----

  const TOP_BUTTON_SIZE = 40;
  const DRAWER_WIDTH = 400;
  const DRAWER_MAX_HEIGHT = 680;

  function placeTopButton(): void {
    const spot = document.fullscreenElement ? null : findMastheadSpot(document, TOP_BUTTON_SIZE);
    topButton.classList.toggle('visible', !!spot);
    if (!spot) {
      if (drawer.classList.contains('visible')) closeDrawer();
      return;
    }
    topButton.style.left = `${spot.left}px`;
    topButton.style.top = `${spot.top}px`;
    placeDrawer();
  }

  function placeDrawer(): void {
    if (!drawer.classList.contains('visible')) return;
    const rect = topButton.getBoundingClientRect();
    const width = Math.min(DRAWER_WIDTH, window.innerWidth - 2 * VIEWPORT_MARGIN);
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.right - width, window.innerWidth - width - VIEWPORT_MARGIN));
    const top = rect.bottom + POPOVER_GAP;
    drawer.style.left = `${left}px`;
    drawer.style.top = `${top}px`;
    drawer.style.width = `${width}px`;
    drawer.style.height = `${Math.min(DRAWER_MAX_HEIGHT, window.innerHeight - top - 12)}px`;
  }

  /** Opens today's answers below the top bar button, scrolled to one video if given. Returns false if the button is not showing. */
  function openDrawer(videoId?: string): boolean {
    if (!topButton.classList.contains('visible')) return false;
    applyTheme();
    const theme = isDark() ? 'dark' : 'light';
    const hash = videoId ? `#${encodeURIComponent(videoId)}` : '';
    const frame = drawer.querySelector('iframe');
    // Reopening keeps the same page, which updates itself, unless YouTube's theme or the video asked for has changed.
    if (!frame || drawerTheme !== theme || hash) {
      const next = element('iframe', 'drawer-frame');
      next.title = "Know It: today's answers";
      next.src = chrome.runtime.getURL(`panel.html?embed=1&theme=${theme}${hash}`);
      drawer.replaceChildren(next);
      drawerTheme = theme;
    }
    drawer.classList.add('visible');
    topButton.setAttribute('aria-expanded', 'true');
    topButton.classList.remove('unseen');
    placeDrawer();
    return true;
  }

  function closeDrawer(): void {
    drawer.classList.remove('visible');
    topButton.setAttribute('aria-expanded', 'false');
  }

  // The list's own close button and Escape key, from inside its frame. Only the extension's own page is listened to.
  const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
  window.addEventListener(
    'message',
    (event) => {
      if (event.origin !== extensionOrigin || event.source !== drawer.querySelector('iframe')?.contentWindow) return;
      if ((event.data as { type?: string } | null)?.type === 'know-it-close') closeDrawer();
    },
    { signal },
  );

  topButton.addEventListener('click', () => {
    if (drawer.classList.contains('visible')) closeDrawer();
    else {
      closePopover();
      openDrawer();
    }
  });

  function isStillThisVideo(found: FoundVideo): boolean {
    // YouTube reuses card elements for other videos as the page changes.
    return found.thumbnail.isConnected && parseVideoId(found.thumbnail.getAttribute('href') ?? '') === found.video.videoId;
  }

  function isOffScreen(rect: DOMRect): boolean {
    return rect.bottom < 0 || rect.top > window.innerHeight;
  }

  function placeButton(): void {
    if (!hovered || !isStillThisVideo(hovered)) {
      button.classList.remove('visible');
      return;
    }
    const rect = hovered.thumbnail.getBoundingClientRect();
    if (rect.width < MIN_THUMBNAIL_WIDTH || isOffScreen(rect)) {
      button.classList.remove('visible');
      return;
    }
    const status = statuses.get(hovered.video.videoId)?.status ?? 'idle';
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
      const status = statuses.get(videoId)?.status;
      if (!status || videoId === hoveredId || !isStillThisVideo(found)) continue;
      const rect = found.thumbnail.getBoundingClientRect();
      if (rect.width < MIN_THUMBNAIL_WIDTH || isOffScreen(rect)) continue;

      let marker = markers.get(videoId);
      if (!marker) {
        marker = createMarker(videoId);
        markers.set(videoId, marker);
        markerLayer.append(marker);
      }
      marker.dataset.status = status;
      marker.title = MARKER_LABELS[status];
      marker.setAttribute('aria-label', MARKER_LABELS[status]);
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
    marker.append(...statusIcons());
    marker.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const found = visible.get(videoId);
      if (found) openPopover(found.video, found.thumbnail, 'thumbnail');
    });
    return marker;
  }

  function releaseTitleSpace(): void {
    reserved?.style.removeProperty('padding-inline-end');
    reserved = null;
  }

  /** The button for the video open on this page: beside the title on a watch page, beside the player on Shorts. */
  function renderPageBar(): void {
    const videoId = currentPageId();
    const found = videoId ? findPageAnchor(document, location.pathname) : null;
    if (!videoId || !found) {
      pageBar.classList.remove('visible');
      releaseTitleSpace();
      return;
    }

    const status = statuses.get(videoId)?.status ?? 'idle';
    pageButton.dataset.status = status;
    pageLabel.textContent = BUTTON_LABELS[status];
    pageButton.setAttribute('aria-label', status === 'idle' ? 'Know it: answer this headline' : BUTTON_LABELS[status]);
    autoSwitch.setAttribute('aria-checked', String(pageState.autoAnswer));
    // Shorts are over before an automatic answer could arrive, so the switch only belongs on full videos.
    autoSwitch.hidden = found.kind === 'shorts';
    pageBar.classList.toggle('fixed', found.kind === 'shorts');
    pageBar.classList.add('visible');
    applyTheme();

    const width = pageBar.offsetWidth;
    const height = pageBar.offsetHeight;
    pagePlayer = found.kind === 'shorts' ? found.element : null;
    if (found.kind === 'watch') {
      // In YouTube's own row of actions, beside Like and its Ask button, so it sits in the same place whatever the title's length.
      const spot = findActionsSpot(document, width);
      if (spot) {
        releaseTitleSpace();
        pageBar.style.left = `${spot.right - width + window.scrollX}px`;
        pageBar.style.top = `${spot.middle - height / 2 + window.scrollY}px`;
      } else {
        // A narrow window leaves no room in that row, so it goes beside the title, keeping the title's text clear of it.
        const title = found.element as HTMLElement;
        if (reserved !== title) releaseTitleSpace();
        reserved = title;
        title.style.setProperty('padding-inline-end', `${width + 16}px`);
        const rect = title.getBoundingClientRect();
        pageBar.style.left = `${rect.right - width + window.scrollX}px`;
        pageBar.style.top = `${rect.top + window.scrollY + 2}px`;
      }
    } else {
      // Inside the player like on a thumbnail, below the strip where YouTube shows pause, mute and the menu.
      releaseTitleSpace();
      const rect = found.element.getBoundingClientRect();
      pageBar.style.left = `${rect.left + SHORTS_INSET}px`;
      pageBar.style.top = `${rect.top + SHORTS_CONTROLS_HEIGHT + 8}px`;
    }
  }

  function placePopover(): void {
    if (!popover.classList.contains('visible')) return;
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;

    let left = maxLeft;
    let top = VIEWPORT_MARGIN + 60;
    if (anchor === pageBar && pagePlayer?.isConnected) {
      // Beside the Short where there is room, so the video stays in view.
      const player = pagePlayer.getBoundingClientRect();
      const rect = pageBar.getBoundingClientRect();
      if (player.left - POPOVER_GAP - width >= VIEWPORT_MARGIN) left = player.left - POPOVER_GAP - width;
      else left = rect.left;
      top = player.left - POPOVER_GAP - width >= VIEWPORT_MARGIN ? player.top : rect.bottom + POPOVER_GAP;
    } else if (anchor === pageBar) {
      const rect = pageBar.getBoundingClientRect();
      left = rect.right - width;
      top = rect.bottom + POPOVER_GAP;
    } else if (anchor?.isConnected) {
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

  /** Where an answer for this video belongs on the page as it is now, if anywhere. */
  function anchorFor(videoId: string): Element | null {
    if (currentPageId() === videoId && pageBar.classList.contains('visible')) return pageBar;
    const found = visible.get(videoId);
    return found && isStillThisVideo(found) ? found.thumbnail : null;
  }

  function openPopover(video: VideoRef, anchorElement: Element | null, source: RequestSource): void {
    openVideo = video;
    openSource = source;
    anchor = anchorElement;
    applyTheme();
    void requestAnswer(video, {});
  }

  function closePopover(): void {
    view.stopTimer();
    popover.classList.remove('visible');
    openVideo = null;
    anchor = null;
  }

  function showPopover(): void {
    popover.classList.add('visible');
    placePopover();
  }

  async function requestAnswer(video: VideoRef, options: { force?: boolean; retry?: boolean }): Promise<void> {
    const videoId = video.videoId;
    const known = statuses.get(videoId);
    const stillOpen = (): boolean => openVideo?.videoId === videoId;
    const showLoading = (startedAt?: number): void => {
      if (!stillOpen()) return;
      view.showLoading(video.title, startedAt);
      showPopover();
    };

    // A request already running, or one the user just asked for by name, shows its progress at once.
    let replied = false;
    if (known?.status === 'loading' || options.force || options.retry) showLoading(known?.startedAt);
    else window.setTimeout(() => !replied && showLoading(), LOADING_DELAY_MS);

    const message: RequestMessage = { type: 'ANSWER_REQUEST', video, source: openSource, ...options };
    let reply: RequestReply | undefined;
    try {
      reply = await send(message);
    } catch {
      // The extension was reloaded after this page opened, which clears chrome.runtime.id.
      // Otherwise the service worker was stopped mid-reply, so the same request is safe to send again.
      if (chrome.runtime?.id) reply = await send<RequestReply>(message).catch(() => undefined);
      if (!reply) {
        replied = true;
        const text = chrome.runtime?.id
          ? 'Could not reach the extension. Try again.'
          : 'The extension was updated. Refresh this page to use it.';
        if (stillOpen()) showResult(video, { ok: false, error: { code: chrome.runtime?.id ? 'server' : 'rejected', message: text } }, false);
        return;
      }
    }
    replied = true;
    if (!reply) return;

    if (reply.pending) {
      setStatus(videoId, { status: 'loading', startedAt: reply.startedAt });
      showLoading(reply.startedAt);
    } else if ('result' in reply) {
      applyResult(videoId, reply.result, false);
      if (stillOpen()) showResult(video, reply.result, reply.offerAuto === true);
    }
  }

  /** Records what happened to a video, so its thumbnail and button show it. */
  function applyResult(videoId: string, result: AnswerResult, quiet: boolean): void {
    if (result.ok) setStatus(videoId, { status: 'ready' });
    else if (quiet || NOT_ABOUT_VIDEO.includes(result.error.code)) setStatus(videoId, null);
    else setStatus(videoId, { status: 'failed', error: result.error });
  }

  function showResult(video: VideoRef, result: AnswerResult, offerAuto: boolean): void {
    if (result.ok) {
      view.showAnswer(video, result.answer, { fromCache: result.fromCache, onPage: currentPageId() === video.videoId, offerAuto });
      void send({ type: 'MARK_SEEN', videoId: video.videoId }).catch(() => undefined);
      if (offerAuto) void send({ type: 'AUTO_OFFER_DONE' }).catch(() => undefined);
    } else if (result.error.code === 'no_key') {
      awaitingKey = video.videoId;
      view.showSetup(video.title, chrome.runtime.getURL(`setup.html?theme=${isDark() ? 'dark' : 'light'}`));
    } else {
      view.showError(video.title, result.error);
    }
    showPopover();
  }

  function setAuto(on: boolean): void {
    pageState = { ...pageState, autoAnswer: on };
    void send({ type: 'SET_AUTO', on }).catch(() => undefined);
    renderPageBar();
    scheduleAuto();
  }

  // ---- Toasts: answers that arrive while the user is somewhere else on the page ----

  function addToast(toast: HTMLElement): void {
    const close = element('button', 'close', '×');
    close.setAttribute('aria-label', 'Dismiss');
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      toast.remove();
    });
    toast.append(close);
    applyTheme();
    toasts.append(toast);
    while (toasts.childElementCount > MAX_TOASTS) toasts.firstElementChild?.remove();

    // The countdown only runs while someone can actually see it.
    let remaining = TOAST_MS;
    const timer = window.setInterval(() => {
      if (!toast.isConnected) return window.clearInterval(timer);
      if (document.visibilityState !== 'visible' || !document.hasFocus() || toast.matches(':hover')) return;
      remaining -= TOAST_TICK_MS;
      if (remaining <= 0) toast.remove();
    }, TOAST_TICK_MS);
  }

  function showAnswerToast(video: VideoRef, result: AnswerResult, source: RequestSource, offerAuto: boolean): void {
    const toast = element('div', result.ok ? 'toast' : 'toast failed');
    const text = element('p', 'toast-text');
    if (result.ok) appendHighlighted(text, result.answer.answer);
    else text.textContent = result.error.message;
    toast.append(...statusIcons().filter((icon) => !icon.classList.contains('spinner')), text);
    if (video.title) toast.append(element('p', 'toast-title', video.title));
    toast.append(element('span', 'link toast-more', result.ok ? 'See more' : 'Details'));
    toast.addEventListener('click', () => {
      toast.remove();
      openVideo = video;
      openSource = source;
      anchor = anchorFor(video.videoId);
      applyTheme();
      showResult(video, result, offerAuto);
    });
    addToast(toast);
  }

  function showNote(message: string): void {
    const toast = element('div', 'toast');
    toast.append(createSparkleIcon('sparkle'), element('p', 'toast-text', message));
    toast.addEventListener('click', () => toast.remove());
    addToast(toast);
  }

  // ---- Answering the open video without a click, for people who turned that on ----

  function scheduleAuto(): void {
    window.clearTimeout(autoTimer);
    const videoId = currentPageId();
    if (!pageState.autoAnswer || !pageState.hasKey || location.pathname !== '/watch') return;
    if (!videoId || autoTried.has(videoId) || statuses.has(videoId) || document.visibilityState !== 'visible') return;
    autoTimer = window.setTimeout(() => void runAuto(videoId), AUTO_DELAY_MS);
  }

  async function runAuto(videoId: string): Promise<void> {
    if (currentPageId() !== videoId || location.pathname !== '/watch' || !pageState.autoAnswer) return;
    if (document.visibilityState !== 'visible' || statuses.has(videoId)) return;
    const video = readCurrentPageVideo(document, location.href);
    if (!video) return;
    autoTried.add(videoId);
    if (video.isLive || (video.durationSeconds !== undefined && video.durationSeconds > AUTO_MAX_VIDEO_SECONDS)) return;

    const reply = await send({ type: 'ANSWER_REQUEST', video, source: 'auto' }).catch(() => undefined);
    if (reply?.pending) setStatus(videoId, { status: 'loading', startedAt: reply.startedAt });
    else if (reply && 'result' in reply && reply.result.ok) setStatus(videoId, { status: 'ready' });
  }

  async function refreshStatuses(): Promise<void> {
    const onPage = [...visible.keys()];
    const pageId = currentPageId();
    if (pageId && !onPage.includes(pageId)) onPage.push(pageId);

    // Anything not yet asked about, plus anything still loading, in case its reply went to another tab.
    const videoIds = onPage.filter((videoId) => !statuses.has(videoId) && !askedStatus.has(videoId));
    for (const [videoId, known] of statuses) {
      if (known.status === 'loading' && !videoIds.includes(videoId)) videoIds.push(videoId);
    }
    if (videoIds.length === 0) return;

    const reply = await send<StatusReply>({ type: 'STATUS_REQUEST', videoIds }).catch(() => undefined);
    if (!reply) return;

    const ready = new Set(reply.ready);
    for (const videoId of videoIds) {
      askedStatus.add(videoId);
      if (videoId in reply.loading) statuses.set(videoId, { status: 'loading', startedAt: reply.loading[videoId] });
      else if (ready.has(videoId)) statuses.set(videoId, { status: 'ready' });
      else if (videoId in reply.failed) statuses.set(videoId, { status: 'failed', error: reply.failed[videoId] });
      else if (statuses.get(videoId)?.status === 'loading') statuses.delete(videoId);
    }
    render();
  }

  let scanning = false;
  async function scan(): Promise<void> {
    // Cut off from the extension, by an update or an uninstall. A button that can't answer is worse than none,
    // and after an update the new copy has already been added to this page.
    if (!chrome.runtime?.id) {
      stop();
      return;
    }
    if (document.hidden || scanning) return;
    scanning = true;
    try {
      const found = findVisibleVideos(document, window.innerWidth, window.innerHeight);
      visible.clear();
      for (const item of found) visible.set(item.video.videoId, item);
      render();
      await refreshStatuses();
    } finally {
      scanning = false;
    }
  }
  const scanTimer = window.setInterval(() => void scan(), SCAN_INTERVAL_MS);

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (hovered) openPopover(hovered.video, hovered.thumbnail, 'thumbnail');
  });

  pageButton.addEventListener('click', () => {
    const video = readCurrentPageVideo(document, location.href);
    if (video) openPopover(video, pageBar, 'page');
  });

  autoSwitch.addEventListener('click', () => {
    const on = !pageState.autoAnswer;
    setAuto(on);
    if (on) showNote('Auto-answer is on. Videos you open that are under 30 minutes are sent to Google for an answer.');
  });

  document.addEventListener(
    'mouseover',
    (event) => {
      if (event.composedPath().includes(host)) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      // The preview player covers the card it belongs to, and has fewer details to read.
      if (target.closest(selector('preview'))) return;

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
    { capture: true, passive: true, signal },
  );

  let frame = 0;
  const reposition = (): void => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      // An answer belongs to its video. Once that has scrolled away, the popover goes too, and a toast brings the answer back.
      if (anchor && popover.classList.contains('visible') && (!anchor.isConnected || isOffScreen(anchor.getBoundingClientRect()))) closePopover();
      render();
      placePopover();
    });
  };
  window.addEventListener('scroll', reposition, { capture: true, passive: true, signal });
  window.addEventListener('resize', reposition, { passive: true, signal });

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.composedPath().includes(host)) return;
      if (popover.classList.contains('visible')) closePopover();
      if (drawer.classList.contains('visible')) closeDrawer();
    },
    { capture: true, passive: true, signal },
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && popover.classList.contains('visible')) closePopover();
      if (event.key === 'Escape' && drawer.classList.contains('visible')) closeDrawer();
    },
    { signal },
  );

  document.addEventListener('visibilitychange', scheduleAuto, { signal });

  // YouTube changes page without a reload, so nothing from the last page should linger.
  document.addEventListener('yt-navigate-start', () => {
    closePopover();
    closeDrawer();
    hovered = null;
    visible.clear();
    pageBar.classList.remove('visible');
    releaseTitleSpace();
    placeButton();
    renderMarkers();
  }, { signal });
  document.addEventListener('yt-navigate-finish', () => {
    renderPageBar();
    scheduleAuto();
  }, { signal });

  const onMessage = (message: TabMessage, _sender: chrome.runtime.MessageSender, sendResponse: (reply: ReadyReply) => void): boolean => {
    if (message.type === 'STATE_CHANGED') {
      applyState(message.state);
    } else if (message.type === 'OPEN_ANSWER') {
      openPopover(message.video, anchorFor(message.video.videoId), 'thumbnail');
    } else if (message.type === 'ANSWER_READY') {
      const { video, result, source } = message;
      const watching = document.visibilityState === 'visible' && document.hasFocus();
      applyResult(video.videoId, result, source === 'auto');
      if (result.ok && !drawer.classList.contains('visible')) topButton.classList.add('unseen');

      if (openVideo?.videoId === video.videoId) {
        showResult(openVideo, result, message.offerAuto === true);
        sendResponse({ shown: watching });
      } else if (source === 'auto' && !result.ok) {
        // Nobody asked for this one, so its failure is nobody's business.
        sendResponse({ shown: true });
      } else {
        showAnswerToast(video, result, source, message.offerAuto === true);
        sendResponse({ shown: watching });
      }
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);

  /** Takes this copy off the page: its buttons, popover, timers and listeners. */
  function stop(): void {
    lifetime.abort();
    window.clearInterval(scanTimer);
    window.clearTimeout(autoTimer);
    view.stopTimer();
    releaseTitleSpace();
    host.remove();
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      // Already cut off from the extension.
    }
  }
  document.addEventListener(REPLACE_EVENT, stop, { once: true, signal });

  void send<PageState>({ type: 'GET_STATE' })
    .then(applyState)
    .catch(() => undefined);
  void scan();
}

function isInside(element: Element, x: number, y: number): boolean {
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// After an install or update the script is also added to tabs that were already open, where an older copy
// may still be running. It hands over to this one. Copies from before 1.2.0 don't listen, so their UI is removed directly.
document.dispatchEvent(new CustomEvent(REPLACE_EVENT));
for (const old of document.querySelectorAll('know-it-root')) old.remove();
start();
