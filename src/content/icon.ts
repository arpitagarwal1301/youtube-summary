const SVG_NS = 'http://www.w3.org/2000/svg';

/** One large sparkle off to one side and two small ones, in warm colours. Deliberately not any company's logo. */
const SPARKLES = [
  'M9.5 4 11 9.5 16.5 11 11 12.5 9.5 18 8 12.5 2.5 11 8 9.5Z',
  'M18 2 18.8 5.2 22 6 18.8 6.8 18 10 17.2 6.8 14 6 17.2 5.2Z',
  'M18 14.5 18.6 16.9 21 17.5 18.6 18.1 18 20.5 17.4 18.1 15 17.5 17.4 16.9Z',
];

let nextGradientId = 0;

export function createSparkleIcon(className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');

  const gradientId = `know-it-sparkle-${nextGradientId++}`;
  const gradient = document.createElementNS(SVG_NS, 'linearGradient');
  gradient.id = gradientId;
  gradient.setAttribute('x1', '0');
  gradient.setAttribute('y1', '0');
  gradient.setAttribute('x2', '1');
  gradient.setAttribute('y2', '1');
  for (const [offset, color] of [['0', '#ffd166'], ['1', '#ff7a59']]) {
    const stop = document.createElementNS(SVG_NS, 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', color);
    gradient.append(stop);
  }
  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.append(gradient);
  svg.append(defs);

  for (const d of SPARKLES) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', `url(#${gradientId})`);
    svg.append(path);
  }
  return svg;
}

/** Simple line icons, drawn in the text colour. */
const LINE_ICONS = {
  copy: ['M9 9h10v10H9z', 'M5 15V5h10'],
  check: ['M5 12.5 10 17 19 7'],
  chevron: ['M7 10l5 5 5-5'],
  refresh: ['M19 12a7 7 0 1 1-2.05-4.95', 'M19 5v4h-4'],
  heart: ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'],
  play: ['M8 5.5v13l10-6.5z'],
  list: ['M9 7h11', 'M9 12h11', 'M9 17h11', 'M4.5 7h.01', 'M4.5 12h.01', 'M4.5 17h.01'],
} as const;
export type LineIconName = keyof typeof LINE_ICONS;

export function createLineIcon(name: LineIconName, className = 'line-icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `${className} icon-${name}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of LINE_ICONS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
