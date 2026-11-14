import type { VideoAnswer, VideoRef } from './types';
import { describeDuration } from './usage';

/** The answer as it reads without highlight markers. */
export function plainText(text: string): string {
  return text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
}

/** Text for the clipboard: the answer, where it came from, and where to get the extension. */
export function shareText(video: Pick<VideoRef, 'videoId' | 'title' | 'durationSeconds'>, answer: VideoAnswer, shareUrl: string): string {
  const saved = video.durationSeconds && video.durationSeconds >= 60 ? `Saved you ${describeDuration(video.durationSeconds)}: ` : '';
  const lines = [`${saved}${plainText(answer.answer)}`];
  for (const point of answer.keyPoints) lines.push(`• ${plainText(point)}`);
  lines.push('', `${video.title ? `${video.title} ` : ''}https://youtu.be/${video.videoId}`, `via Know It for YouTube ${shareUrl}`);
  return lines.join('\n');
}
