import type { AnswerError, VideoAnswer, VideoRef } from '../shared/types';
import { describeDuration } from '../shared/usage';
import { formatClock, watchUrl } from '../shared/video';
import { createLineIcon, type LineIconName } from './icon';

const SLOW_HINT_AFTER_SECONDS = 30;
/** Past the service worker's own limit, so a retry starts a new request. Only reached if a reply got lost. */
const GIVE_UP_AFTER_SECONDS = 310;
const COPIED_FOR_MS = 1800;

/** Errors where trying again immediately cannot help. */
const FINAL_ERRORS: AnswerError['code'][] = ['daily_limit', 'unavailable', 'blocked', 'too_long'];
/** Errors the panel can fix. */
const PANEL_ERRORS: AnswerError['code'][] = ['invalid_key', 'no_model'];

export interface PopoverActions {
  close(): void;
  /** `force` asks again even though an answer is saved. */
  retry(force: boolean): void;
  openPanel(): void;
  copy(answer: VideoAnswer): Promise<boolean>;
  /** Moves the open video to this moment. Returns false if this page is not playing that video. */
  seek(seconds: number): boolean;
  setAuto(on: boolean): void;
  /** Where the heart at the bottom of an answer leads. Empty hides it. */
  sponsorUrl(): string;
  /** Length of every video answered today, in seconds. */
  savedToday(): Promise<number>;
}

export interface AnswerOptions {
  fromCache: boolean;
  /** The video is the one open on this page, so its timestamp can move the player instead of opening a tab. */
  onPage: boolean;
  /** Ask once whether to answer opened videos automatically from now on. */
  offerAuto: boolean;
}

/** Everything from the model is set with textContent, because a video could try to inject markup. */
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class PopoverView {
  private timer: number | undefined;

  constructor(
    private readonly container: HTMLElement,
    private readonly actions: PopoverActions,
  ) {}

  /** `startedAt` is when the request really began, so reopening carries on counting rather than starting again. */
  showLoading(title: string, startedAt = Date.now()): void {
    this.reset(title);

    const label = element('span');
    const row = element('div', 'loading');
    row.append(element('div', 'spinner'), label);
    this.container.append(row);

    const hint = element('p', 'hint', 'Longer videos can take a few minutes. Carry on browsing: the answer will pop up here when it is ready.');
    hint.hidden = true;
    this.container.append(hint);

    const update = (): void => {
      const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
      label.textContent = seconds > 0 ? `Watching the video… ${seconds}s` : 'Watching the video…';
      if (seconds >= SLOW_HINT_AFTER_SECONDS) hint.hidden = false;
      if (seconds >= GIVE_UP_AFTER_SECONDS) {
        this.showError(title, { code: 'timeout', message: 'No answer came back from Gemini. Try again.' });
      }
    };
    update();
    this.timer = window.setInterval(update, 1000);
  }

  showAnswer(video: Pick<VideoRef, 'videoId' | 'title' | 'durationSeconds'>, answer: VideoAnswer, options: AnswerOptions): void {
    const length = video.durationSeconds && video.durationSeconds >= 60 ? describeDuration(video.durationSeconds) : '';
    this.reset(length ? `${video.title} · ${length}` : video.title);

    // The answer is the one thing highlighted. Everything below it steps down.
    const answerText = element('p', 'answer');
    appendHighlighted(answerText, answer.answer);
    this.container.append(answerText);

    if (answer.keyPoints.length > 0) this.container.append(pointList('points', answer.keyPoints));

    const cautions: string[] = [];
    if (!answer.titleDelivers) cautions.push("Doesn't deliver what its title promises");
    if (answer.nameIsGuess) cautions.push("The name isn't in the title, tags or description, so it may be a guess");
    else if (answer.confidence === 'low') cautions.push('Low confidence');
    if (cautions.length > 0) this.container.append(element('p', 'caution', cautions.join('. ') + '.'));

    const actions = element('div', 'actions');
    if (answer.evidence) actions.append(this.evidenceLink(video.videoId, answer.evidence, options.onPage));
    let summaryList: HTMLUListElement | null = null;
    if (answer.summary.length > 0) {
      summaryList = pointList('summary', answer.summary);
      summaryList.hidden = true;

      const list = summaryList;
      const toggle = actionButton('chevron', 'Summary');
      toggle.classList.add('toggle');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => {
        list.hidden = !list.hidden;
        toggle.setAttribute('aria-expanded', String(!list.hidden));
      });
      actions.append(toggle);
    }

    const copy = actionButton('copy', 'Copy');
    copy.title = 'Copy this answer to share it';
    copy.addEventListener('click', async () => {
      const done = await this.actions.copy(answer);
      copy.replaceChildren(createLineIcon(done ? 'check' : 'copy'), element('span', undefined, done ? 'Copied' : 'Could not copy'));
      window.setTimeout(() => copy.replaceChildren(createLineIcon('copy'), element('span', undefined, 'Copy')), COPIED_FOR_MS);
    });
    actions.append(copy);

    if (options.fromCache) {
      const again = element('button', 'action icon-only');
      again.type = 'button';
      again.append(createLineIcon('refresh'));
      again.setAttribute('aria-label', 'Ask again');
      again.title = 'Ask again. Counts towards your daily limit.';
      again.addEventListener('click', () => this.actions.retry(true));
      actions.append(again);
    }
    this.container.append(actions);
    if (summaryList) this.container.append(summaryList);

    if (options.offerAuto) this.container.append(this.autoOffer());
    this.container.append(this.footer());
  }

  showError(title: string, error: AnswerError): void {
    this.reset(title);
    this.container.append(element('p', 'error', error.message));

    const actions = element('div', 'actions');
    if (PANEL_ERRORS.includes(error.code)) {
      const panel = element('button', 'link', 'Open Know It');
      panel.addEventListener('click', () => this.actions.openPanel());
      actions.append(panel);
    } else if (!FINAL_ERRORS.includes(error.code)) {
      const retry = element('button', 'link', 'Try again');
      retry.addEventListener('click', () => this.actions.retry(false));
      actions.append(retry);
    }
    if (actions.childElementCount > 0) this.container.append(actions);
  }

  /**
   * First use: the two steps to get a key, right where the user clicked. The field itself is a frame owned by the
   * extension, so the page it sits on can never read what is typed into it.
   */
  showSetup(title: string, frameUrl: string): void {
    this.reset(title);
    this.container.append(
      element('p', 'setup-lead', 'One-time setup, about a minute'),
      element('p', 'hint setup-hint', 'Know It uses your own free Gemini key from Google. It stays in this browser.'),
    );
    const frame = element('iframe', 'setup-frame');
    frame.title = 'Add your Gemini API key';
    frame.src = frameUrl;
    this.container.append(frame);
  }

  stopTimer(): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
  }

  private evidenceLink(videoId: string, evidence: NonNullable<VideoAnswer['evidence']>, onPage: boolean): HTMLAnchorElement {
    const link = element('a', 'action');
    link.append(createLineIcon('play'), element('span', undefined, formatClock(evidence.seconds)));
    const verb = onPage ? 'Jump to' : 'Check it at';
    link.title = evidence.note ? `${verb} ${formatClock(evidence.seconds)}: ${evidence.note}` : `${verb} ${formatClock(evidence.seconds)}`;
    link.setAttribute('aria-label', link.title);
    link.href = watchUrl(videoId, evidence.seconds);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    if (onPage) {
      link.addEventListener('click', (event) => {
        // Falls back to the link itself, in a new tab, if this page turns out not to be playing the video.
        if (this.actions.seek(evidence.seconds)) event.preventDefault();
      });
    }
    return link;
  }

  /** Today's answers live in the toolbar panel, which people often never find because Chrome hides extension icons. */
  private footer(): HTMLElement {
    const footer = element('div', 'popover-footer');
    const all = element('button', 'link quiet');
    all.append(createLineIcon('list'), element('span', undefined, "Today's answers"));
    all.title = 'Every answer from today';
    all.addEventListener('click', () => this.actions.openPanel());
    // Filled in once known, and only once it is worth saying.
    const saved = element('span', 'saved');
    all.append(saved);
    void this.actions.savedToday().then((seconds) => {
      if (seconds < 60) return;
      saved.replaceChildren(document.createTextNode(' · '), element('strong', undefined, describeDuration(seconds)), document.createTextNode(' saved'));
    }, () => undefined);
    footer.append(all);

    const sponsorUrl = this.actions.sponsorUrl();
    if (sponsorUrl) {
      const heart = element('a', 'sponsor');
      heart.href = sponsorUrl;
      heart.target = '_blank';
      heart.rel = 'noopener noreferrer';
      heart.title = 'Know It is free and made by one person';
      heart.append(createLineIcon('heart'), element('span', undefined, 'Sponsor'));
      footer.append(heart);
    }
    return footer;
  }

  private autoOffer(): HTMLElement {
    const offer = element('div', 'offer');
    const text = element('p', undefined, 'Do this automatically for every video you open?');
    const note = element('p', 'hint', 'Videos under 30 minutes are sent to Google 5 seconds after you open them. You can turn it off beside the Know it button.');
    const row = element('div', 'actions');
    const yes = element('button', 'primary', 'Turn on');
    const no = element('button', 'link', 'No thanks');
    yes.addEventListener('click', () => {
      this.actions.setAuto(true);
      offer.replaceChildren(element('p', 'hint', 'On. Answers will appear by themselves from the next video.'));
    });
    no.addEventListener('click', () => offer.remove());
    row.append(yes, no);
    offer.append(text, note, row);
    return offer;
  }

  private reset(title: string): void {
    this.stopTimer();
    this.container.replaceChildren();

    const header = element('div', 'header');
    const close = element('button', 'close', '×');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.actions.close());
    header.append(element('p', 'video-title', title), close);
    this.container.append(header);
  }
}

function actionButton(icon: LineIconName, label: string): HTMLButtonElement {
  const button = element('button', 'action');
  button.type = 'button';
  button.append(createLineIcon(icon), element('span', undefined, label));
  return button;
}

/** Turns **marked** words into highlights, building elements rather than parsing text as HTML. */
export function appendHighlighted(parent: HTMLElement, text: string, tag: 'mark' | 'strong' = 'mark'): void {
  text.split(/\*\*(.+?)\*\*/s).forEach((part, index) => {
    // Odd parts are the ones the pattern captured.
    const clean = part.replace(/\*\*/g, '');
    if (!clean) return;
    parent.append(index % 2 === 1 ? element(tag, undefined, clean) : document.createTextNode(clean));
  });
}

function pointList(className: string, points: string[]): HTMLUListElement {
  const list = element('ul', className);
  for (const point of points) {
    const item = element('li');
    // Only the answer itself gets the highlight. Key words here are just bolder.
    appendHighlighted(item, point, 'strong');
    list.append(item);
  }
  return list;
}
