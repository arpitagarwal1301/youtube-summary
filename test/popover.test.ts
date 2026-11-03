// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { PopoverView, appendHighlighted } from '../src/content/popover';
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

  function render(change: Partial<VideoAnswer> = {}): HTMLElement {
    const container = document.createElement('div');
    new PopoverView(container, { close: vi.fn(), retry: vi.fn(), openSettings: vi.fn() }).showAnswer('Title', 'dQw4w9WgXcQ', { ...answer, ...change }, false);
    return container;
  }

  it('shows the answer and points with highlights, with the summary hidden', () => {
    const container = render();
    expect(marks(container.querySelector('.answer')!)).toEqual(['banking']);
    expect(marks(container.querySelector('.points')!)).toEqual(['cheap', 'almost there']);
    expect(container.querySelectorAll('.points li')).toHaveLength(2);
    expect(container.querySelector<HTMLElement>('.summary')!.hidden).toBe(true);
  });

  it('shows the summary on request', () => {
    const container = render();
    const toggle = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Show summary')!;
    toggle.click();
    expect(container.querySelector<HTMLElement>('.summary')!.hidden).toBe(false);
    expect(toggle.textContent).toBe('Hide summary');
  });

  it('leaves out the list when there are no key points', () => {
    expect(render({ keyPoints: [] }).querySelector('.points')).toBeNull();
  });
});
