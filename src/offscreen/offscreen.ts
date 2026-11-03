import { addPageDetails } from '../background/details';
import { runGemini } from '../background/gemini';
import type { GeminiDoneMessage, RunGeminiMessage } from '../shared/types';

// Chrome stops a service worker when a fetch takes over 30 seconds to respond, and Gemini can take
// longer than that on a video. This page has no such limit, and its reply wakes the worker back up.
chrome.runtime.onMessage.addListener((message: RunGeminiMessage | { type: string }, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab || message.type !== 'RUN_GEMINI') return false;

  const { jobKey, job } = message as RunGeminiMessage;
  void addPageDetails(job.video)
    .then((video) => runGemini({ ...job, video }))
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
