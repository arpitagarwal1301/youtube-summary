const VIDEO_ID = /^[\w-]{11}$/;

/** Returns the video ID for a watch, Shorts, live, embed or youtu.be link, or null for anything else. */
export function parseVideoId(href: string, base = 'https://www.youtube.com'): string | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }

  let id: string | null = null;
  if (url.hostname === 'youtu.be') {
    id = url.pathname.slice(1).split('/')[0];
  } else if (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')) {
    const [, section, rest] = url.pathname.split('/');
    if (section === 'watch') id = url.searchParams.get('v');
    else if (section === 'shorts' || section === 'live' || section === 'embed') id = rest;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** Always a plain watch URL: Gemini rejects other forms, and this also drops Mix and playlist parameters. */
export function watchUrl(videoId: string, startSeconds?: number): string {
  const base = `https://www.youtube.com/watch?v=${videoId}`;
  return startSeconds ? `${base}&t=${startSeconds}s` : base;
}

/** Parses "4:05" or "1:02:03" to seconds, or returns undefined if the text is not a clock. */
export function parseClock(text: string): number | undefined {
  if (!/^\d{1,3}(:\d{2}){1,2}$/.test(text.trim())) return undefined;
  return text
    .trim()
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0);
}

export function formatClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const ss = String(seconds).padStart(2, '0');
  if (hours === 0) return `${minutes}:${ss}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
}
