import { addPageDetails } from '../background/details';
import { runGemini } from '../background/gemini';
import type { GeminiDoneMessage, RunGeminiMessage } from '../shared/types';

// Chrome stops a service worker when a fetch takes over 30 seconds to respond, and Gemini can take
// longer than that on a video. This page has no such limit, and its reply wakes the worker back up.
chrome.runtime.onMessage.addListener((message: RunGeminiMessage | { type: string }, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab || message.type !== 'RUN_GEMINI') return false;

  const { jobKey, job } = message as RunGeminiMessage;
  void addPageDetails(job.video)
    .then((video): GeminiDoneMessage['outcome'] | Promise<GeminiDoneMessage['outcome']> => {
      if (job.maxSeconds !== undefined) {
        // An automatic request only goes ahead once the page has confirmed the video is short enough.
        if (video.isLive || video.durationSeconds === undefined || video.durationSeconds > job.maxSeconds) return { ok: false, skipped: true };
      } else if (video.isLive) {
        return { ok: false, error: { code: 'unavailable', message: 'Live streams cannot be answered until they have finished.' } };
      }
      return runGemini({ ...job, video });
    })
    .catch((): GeminiDoneMessage['outcome'] => ({
      ok: false,
      error: { code: 'server', message: 'Something went wrong. Try again.' },
    }))
    .then((outcome) => {
      const done: GeminiDoneMessage = { type: 'GEMINI_DONE', jobKey, outcome };
      return chrome.runtime.sendMessage(done);
    });

  sendResponse(true);
  return false;
});
