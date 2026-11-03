import type { VideoRef } from '../shared/types';
import { watchUrl } from '../shared/video';

const DETAILS_TIMEOUT_MS = 8000;
const MAX_DESCRIPTION_CHARS = 1500;
const MAX_KEYWORDS = 30;

/**
 * Adds the uploader's description and tags, which usually name the film or song that a headline hides.
 * This is only a helper: if the page cannot be read, Gemini still gets the video.
 */
export async function addPageDetails(video: VideoRef): Promise<VideoRef> {
  try {
    // No cookies, so this does not touch the viewer's watch history or recommendations.
    const response = await fetch(watchUrl(video.videoId), {
      credentials: 'omit',
      signal: AbortSignal.timeout(DETAILS_TIMEOUT_MS),
    });
    if (!response.ok) return video;
    return { ...parsePageDetails(await response.text()), ...video };
  } catch {
    return video;
  }
}

export function parsePageDetails(html: string): Partial<VideoRef> {
  const details: Partial<VideoRef> = {};

  const description = readJson<string>(html, /"shortDescription":("(?:[^"\\]|\\.)*")/);
  if (description?.trim()) details.description = description.trim().slice(0, MAX_DESCRIPTION_CHARS);

  const keywords = readJson<string[]>(html, /"keywords":(\[(?:"(?:[^"\\]|\\.)*",?)*\])/);
  if (keywords?.length) details.keywords = keywords.slice(0, MAX_KEYWORDS);

  const length = Number(html.match(/"lengthSeconds":"(\d+)"/)?.[1]);
  if (length > 0) details.durationSeconds = length;

  return details;
}

function readJson<T>(html: string, pattern: RegExp): T | undefined {
  const match = html.match(pattern);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]) as T;
  } catch {
    return undefined;
  }
}
