// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { PopoverView, appendHighlighted, type AnswerOptions, type PopoverActions } from '../src/content/popover';

const actions = (): PopoverActions => ({
  close: vi.fn(),
  retry: vi.fn(),
  openPanel: vi.fn(),
  copy: vi.fn(async () => true),
  seek: vi.fn(() => false),
  setAuto: vi.fn(),
  sponsorUrl: () => 'https://github.com/sponsors/someone',
  savedToday: async () => 2340,
});
import type { VideoAnswer } from '../src/shared/types';

function highlighted(text: string): HTMLElement {
  const parent = document.createElement('p');
  appendHighlighted(parent, text);
  return parent;
}

const marks = (parent: Element) => [...parent.querySelectorAll('mark')].map((mark) => mark.textContent);

describe('appendHighlighted', () => {
  it('highlights marked words and keeps the rest as text', () => {
    const parent = highlighted('Starts at **₹4.25 Cr** in **Pune** today');
    expect(marks(parent)).toEqual(['₹4.25 Cr', 'Pune']);
    expect(parent.textContent).toBe('Starts at ₹4.25 Cr in Pune today');
  });

  it('handles text with no highlights', () => {
    const parent = highlighted('Plain answer');
    expect(marks(parent)).toEqual([]);
    expect(parent.textContent).toBe('Plain answer');
  });

  it('removes stray markers rather than showing them', () => {
    expect(highlighted('Broken **marker').textContent).toBe('Broken marker');
    expect(highlighted('** **').querySelectorAll('mark')).toHaveLength(1);
  });

  it('never turns model output into page markup', () => {
    const parent = highlighted('**<img src=x onerror=alert(1)>** and <b>bold</b>');
    expect(parent.querySelector('img')).toBeNull();
    expect(parent.querySelector('b')).toBeNull();
    expect(marks(parent)).toEqual(['<img src=x onerror=alert(1)>']);
  });
});

describe('PopoverView.showAnswer', () => {
  const answer: VideoAnswer = {
    category: 'finance',
    question: 'What are his bets?',
    answer: 'His bets are **banking** and IT.',
    keyPoints: ['Banks look **cheap**', 'IT is **almost there**'],
    summary: ['More **detail**'],
    confidence: 'high',
    titleDelivers: true,
  };

  const video = { videoId: 'dQw4w9WgXcQ', title: 'Title' };
  function render(change: Partial<VideoAnswer> = {}, options: Partial<AnswerOptions> = {}): HTMLElement {
    const container = document.createElement('div');
    new PopoverView(container, actions()).showAnswer(video, { ...answer, ...change }, { fromCache: false, onPage: false, offerAuto: false, ...options });
    return container;
  }

  const button = (container: Element, text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text);

  it('copies the answer and says so', async () => {
    const copy = vi.fn(async () => true);
    const container = document.createElement('div');
    new PopoverView(container, { ...actions(), copy }).showAnswer(video, answer, { fromCache: false, onPage: false, offerAuto: false });
    button(container, 'Copy')!.click();
    await vi.waitFor(() => expect(button(container, 'Copied')).toBeTruthy());
    expect(copy).toHaveBeenCalledWith(answer);
  });

  it("links to today's answers in the panel", () => {
    const openPanel = vi.fn();
    const container = document.createElement('div');
    new PopoverView(container, { ...actions(), openPanel }).showAnswer(video, answer, { fromCache: false, onPage: false, offerAuto: false });
    button(container, "Today's answers")!.click();
    expect(openPanel).toHaveBeenCalled();
  });

  it('ends with a sponsor link', () => {
    expect(render().querySelector<HTMLAnchorElement>('a.sponsor')!.href).toBe('https://github.com/sponsors/someone');
  });

  it('offers Ask again only for a saved answer', () => {
    const again = (container: Element) => container.querySelector('[aria-label="Ask again"]');
    expect(again(render())).toBeNull();
    expect(again(render({}, { fromCache: true }))).toBeTruthy();
  });

  it('jumps the player in place when the video is open on this page', () => {
    const seek = vi.fn(() => true);
    const container = document.createElement('div');
    new PopoverView(container, { ...actions(), seek }).showAnswer(video, { ...answer, evidence: { seconds: 75, note: 'here' } }, {
      fromCache: false,
      onPage: true,
      offerAuto: false,
    });
    const link = container.querySelector<HTMLAnchorElement>('a.action')!;
    expect(link.textContent).toBe('1:15');
    expect(link.title).toBe('Jump to 1:15: here');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(seek).toHaveBeenCalledWith(75);
    expect(event.defaultPrevented).toBe(true);
  });

  it('offers automatic answers once, and turns them on', () => {
    const setAuto = vi.fn();
    const container = document.createElement('div');
    new PopoverView(container, { ...actions(), setAuto }).showAnswer(video, answer, { fromCache: false, onPage: true, offerAuto: true });
    button(container, 'Turn on')!.click();
    expect(setAuto).toHaveBeenCalledWith(true);
    expect(container.querySelector('.offer')!.textContent).toContain('On.');
  });

  it('highlights only the answer, with key words in points just bolder, and the summary hidden', () => {
    const container = render();
    expect(marks(container.querySelector('.answer')!)).toEqual(['banking']);
    expect(marks(container.querySelector('.points')!)).toEqual([]);
    expect([...container.querySelectorAll('.points strong')].map((node) => node.textContent)).toEqual(['cheap', 'almost there']);
    expect(container.querySelectorAll('.points li')).toHaveLength(2);
    expect(container.querySelector<HTMLElement>('.summary')!.hidden).toBe(true);
  });

  it('shows the summary on request', () => {
    const container = render();
    const toggle = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Summary')!;
    toggle.click();
    expect(container.querySelector<HTMLElement>('.summary')!.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it("shows the video's length and today's saved total, but no question or chips", async () => {
    const container = document.createElement('div');
    new PopoverView(container, actions()).showAnswer({ ...video, durationSeconds: 754 }, answer, { fromCache: false, onPage: false, offerAuto: false });
    expect(container.querySelector('.video-title')!.textContent).toBe('Title · 12 min');
    expect(container.querySelector('.question')).toBeNull();
    expect(container.querySelector('.chip')).toBeNull();
    await vi.waitFor(() => expect(container.querySelector('.saved')!.textContent).toBe(' · 39 min saved'));
  });

  it('puts every caution on one quiet line', () => {
    const text = render({ titleDelivers: false, confidence: 'low' }).querySelector('.caution')!.textContent;
    expect(text).toBe("Doesn't deliver what its title promises. Low confidence.");
  });

  it('leaves out the list when there are no key points', () => {
    expect(render({ keyPoints: [] }).querySelector('.points')).toBeNull();
  });
});

describe('PopoverView errors and loading', () => {
  const button = (container: Element, text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text);

  it('offers Try again for a passing problem, and nothing for a final one', () => {
    const container = document.createElement('div');
    const view = new PopoverView(container, actions());
    view.showError('T', { code: 'network', message: 'Offline' });
    expect(button(container, 'Try again')).toBeTruthy();
    view.showError('T', { code: 'daily_limit', message: 'Limit' });
    expect(button(container, 'Try again')).toBeUndefined();
  });

  it('sends key and model problems to the panel', () => {
    const container = document.createElement('div');
    const openPanel = vi.fn();
    new PopoverView(container, { ...actions(), openPanel }).showError('T', { code: 'invalid_key', message: 'Bad key' });
    button(container, 'Open Know It')!.click();
    expect(openPanel).toHaveBeenCalled();
  });

  it('carries on counting from when the request began', () => {
    const container = document.createElement('div');
    const view = new PopoverView(container, actions());
    view.showLoading('T', Date.now() - 42_000);
    expect(container.querySelector('.loading')!.textContent).toBe('Watching the video… 42s');
    expect(container.querySelector<HTMLElement>('.hint')!.hidden).toBe(false);
    view.stopTimer();
  });

  it('shows the setup frame from the extension', () => {
    const container = document.createElement('div');
    new PopoverView(container, actions()).showSetup('T', 'chrome-extension://abc/setup.html');
    expect(container.querySelector('iframe')!.getAttribute('src')).toBe('chrome-extension://abc/setup.html');
  });
});
