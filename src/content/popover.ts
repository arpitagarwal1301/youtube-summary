import type { AnswerError, Category, VideoAnswer } from '../shared/types';
import { formatClock, watchUrl } from '../shared/video';

const CATEGORY_LABELS: Record<Category, string> = {
  movie_tv: 'Movie or TV',
  music: 'Music',
  finance: 'Finance',
  news: 'News',
  product_tech: 'Product or tech',
  real_estate: 'Property',
  education: 'Education',
  how_to: 'How-to',
  sports: 'Sports',
  gaming: 'Gaming',
  vlog: 'Vlog',
  other: 'General',
};

const SLOW_HINT_AFTER_SECONDS = 30;
/** Past the service worker's own limit, so a retry starts a new request. Only reached if a reply got lost. */
const GIVE_UP_AFTER_SECONDS = 310;

/** Errors that a settings change can fix, so they get a settings link instead of "Try again". */
const SETTINGS_ERRORS: AnswerError['code'][] = ['no_key', 'invalid_key'];
/** Errors where trying again immediately cannot help. */
const FINAL_ERRORS: AnswerError['code'][] = ['daily_limit', 'unavailable', 'blocked', 'too_long'];

export interface PopoverActions {
  close(): void;
  retry(force: boolean): void;
  openSettings(): void;
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

  showLoading(title: string): void {
    this.reset(title);

    const label = element('span', undefined, 'Watching the video…');
    const row = element('div', 'loading');
    row.append(element('div', 'spinner'), label);
    this.container.append(row);

    const startedAt = Date.now();
    const hint = element('p', 'hint');
    hint.hidden = true;
    hint.textContent = 'Longer videos can take a few minutes. You can close this and come back: the answer will be saved.';
    this.container.append(hint);

    this.timer = window.setInterval(() => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      label.textContent = `Watching the video… ${seconds}s`;
      if (seconds >= SLOW_HINT_AFTER_SECONDS) hint.hidden = false;
      if (seconds >= GIVE_UP_AFTER_SECONDS) {
        this.showError(title, { code: 'timeout', message: 'No answer came back from Gemini. Try again.' });
      }
    }, 1000);
  }

  showAnswer(title: string, videoId: string, answer: VideoAnswer, fromCache: boolean): void {
    this.reset(title);

    if (answer.question) this.container.append(element('p', 'question', answer.question));
    const answerText = element('p', 'answer');
    appendHighlighted(answerText, answer.answer);
    this.container.append(answerText);

    if (answer.keyPoints.length > 0) this.container.append(pointList('points', answer.keyPoints));

    if (!answer.titleDelivers) {
      this.container.append(element('p', 'warning', 'This video does not really deliver what its headline promises.'));
    }

    if (answer.nameIsGuess) {
      this.container.append(element('p', 'warning', "This name isn't in the video's title, tags or description, so it may be a wrong guess."));
    }

    const meta = element('div', 'meta');
    meta.append(
      element('span', 'chip', CATEGORY_LABELS[answer.category]),
      element('span', 'chip', `${capitalize(answer.confidence)} confidence`),
    );
    this.container.append(meta);

    if (answer.evidence) {
      const link = element('a', 'evidence', evidenceLabel(answer.evidence));
      link.href = watchUrl(videoId, answer.evidence.seconds);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      this.container.append(link);
    }

    const actions = element('div', 'actions');
    let summaryList: HTMLUListElement | null = null;
    if (answer.summary.length > 0) {
      summaryList = pointList('summary', answer.summary);
      summaryList.hidden = true;

      const list = summaryList;
      const toggle = element('button', 'link', 'Show summary');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => {
        list.hidden = !list.hidden;
        toggle.textContent = list.hidden ? 'Show summary' : 'Hide summary';
        toggle.setAttribute('aria-expanded', String(!list.hidden));
      });
      actions.append(toggle);
    }
    if (fromCache) {
      const again = element('button', 'link', 'Ask again');
      again.title = 'Saved answer. Asking again counts towards your daily limit.';
      again.addEventListener('click', () => this.actions.retry(true));
      actions.append(again);
    }
    if (actions.childElementCount > 0) this.container.append(actions);
    if (summaryList) this.container.append(summaryList);
  }

  showError(title: string, error: AnswerError): void {
    this.reset(title);
    this.container.append(element('p', 'error', error.message));

    const actions = element('div', 'actions');
    if (SETTINGS_ERRORS.includes(error.code)) {
      const settings = element('button', 'link', 'Open settings');
      settings.addEventListener('click', () => this.actions.openSettings());
      actions.append(settings);
    } else if (!FINAL_ERRORS.includes(error.code)) {
      const retry = element('button', 'link', 'Try again');
      retry.addEventListener('click', () => this.actions.retry(false));
      actions.append(retry);
    }
    if (actions.childElementCount > 0) this.container.append(actions);
  }

  stopTimer(): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
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

/** Turns **marked** words into highlights, building elements rather than parsing text as HTML. */
export function appendHighlighted(parent: HTMLElement, text: string): void {
  text.split(/\*\*(.+?)\*\*/s).forEach((part, index) => {
    // Odd parts are the ones the pattern captured.
    const clean = part.replace(/\*\*/g, '');
    if (!clean) return;
    parent.append(index % 2 === 1 ? element('mark', undefined, clean) : document.createTextNode(clean));
  });
}

function pointList(className: string, points: string[]): HTMLUListElement {
  const list = element('ul', className);
  for (const point of points) {
    const item = element('li');
    appendHighlighted(item, point);
    list.append(item);
  }
  return list;
}

function evidenceLabel(evidence:NonNullable<VideoAnswer['evidence']>): string {
  const clock = `Check it at ${formatClock(evidence.seconds)}`;
  return evidence.note ? `${clock}: ${evidence.note}` : clock;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
