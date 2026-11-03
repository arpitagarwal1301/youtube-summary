import { cacheKey, findCached, readCached, writeCached } from '../shared/cache';
import { getSettings } from '../shared/settings';
import type {
  AnswerError,
  AnswerResult,
  GeminiDoneMessage,
  GeminiOutcome,
  RequestMessage,
  RequestReply,
  RunGeminiMessage,
  SkipReason,
  StatusReply,
  TabMessage,
  VideoRef,
} from '../shared/types';
import { DAILY_LIMIT_SECONDS, PREFETCH_LIMIT_SECONDS, addUsedSeconds, getUsedSeconds, secondsForVideo } from '../shared/usage';
import { formatClock, parseVideoId } from '../shared/video';

const OFFSCREEN_PATH = 'offscreen.html';
const JOBS_KEY = 'jobs';
/** Slightly longer than the request timeout, so a job lost to a crash cannot block a video forever. */
const JOB_STALE_MS = 5 * 60 * 1000;

interface Job {
  video: VideoRef;
  tabIds: number[];
  startedAt: number;
  /** Started automatically rather than by a click. Only one of these runs at a time, to stay inside rate limits. */
  background?: boolean;
}
type Jobs = Record<string, Job>;

// The worker can be stopped while a request runs, so jobs live in session storage.
// Updates go through a queue because two tabs can ask at the same moment.
let queue: Promise<unknown> = Promise.resolve();
function updateJobs<T>(update: (jobs: Jobs) => T | Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const stored = await chrome.storage.session.get(JOBS_KEY);
    const jobs = (stored[JOBS_KEY] ?? {}) as Jobs;
    const result = await update(jobs);
    await chrome.storage.session.set({ [JOBS_KEY]: jobs });
    return result;
  });
  queue = next.catch(() => undefined);
  return next;
}

async function handleRequest(
  video: VideoRef,
  force: boolean,
  tabId: number | undefined,
  background: boolean,
): Promise<RequestReply> {
  const settings = await getSettings();
  const jobKey = cacheKey(video.videoId, settings.language);

  if (!force) {
    const cached = await readCached(jobKey);
    if (cached) return done({ ok: true, answer: cached, fromCache: true });
  }
  if (background && (!settings.prefetch || !settings.apiKey || video.isLive)) return skipped('off');
  if (!settings.apiKey) {
    return failed({ code: 'no_key', message: 'Add your free Gemini API key in settings to get answers.' });
  }
  if (video.isLive) {
    return failed({ code: 'unavailable', message: 'Live streams cannot be answered until they have finished.' });
  }

  const used = await getUsedSeconds();
  // At or over, because a video with no known length adds nothing here and would otherwise always get through.
  if (background && used + (video.durationSeconds ?? 0) >= PREFETCH_LIMIT_SECONDS) return skipped('budget');
  if (used + (video.durationSeconds ?? 0) >= DAILY_LIMIT_SECONDS) {
    return failed({
      code: 'daily_limit',
      message: `This would pass the free limit of ${DAILY_LIMIT_SECONDS / 3600} hours of video a day (${formatClock(used)} used). It resets at midnight Pacific time. Saved answers still work.`,
    });
  }

  // Starting runs inside the queue, so the offscreen page cannot be closed by a job that just finished.
  return updateJobs(async (jobs): Promise<RequestReply> => {
    const existing = jobs[jobKey] as Job | undefined;
    if (existing && isFresh(existing)) {
      if (tabId !== undefined && !existing.tabIds.includes(tabId)) existing.tabIds.push(tabId);
      // A click on a video being prepared means it no longer holds the background slot.
      if (!background) existing.background = false;
      return { pending: true };
    }
    if (background && Object.values(jobs).some((job) => job.background && isFresh(job))) return skipped('busy');

    try {
      await ensureOffscreen();
      const message: RunGeminiMessage = {
        type: 'RUN_GEMINI',
        jobKey,
        job: { video, apiKey: settings.apiKey, model: settings.model, language: settings.language },
      };
      await chrome.runtime.sendMessage(message);
    } catch (err) {
      console.error('Could not start the Gemini request', err);
      return failed({ code: 'server', message: 'Could not start the request. Try again.' });
    }

    jobs[jobKey] = { video, tabIds: tabId === undefined ? [] : [tabId], startedAt: Date.now(), background };
    return { pending: true };
  });
}

async function handleStatus(videoIds: string[]): Promise<StatusReply> {
  const { language } = await getSettings();
  const keyFor = (videoId: string) => cacheKey(videoId, language);

  const saved = await findCached(videoIds.map(keyFor));
  const stored = await chrome.storage.session.get(JOBS_KEY);
  const jobs = (stored[JOBS_KEY] ?? {}) as Jobs;

  const isRunning = (videoId: string) => {
    const job = jobs[keyFor(videoId)] as Job | undefined;
    return job !== undefined && isFresh(job);
  };
  const loading = videoIds.filter(isRunning);
  return { loading, ready: videoIds.filter((videoId) => saved.has(keyFor(videoId)) && !isRunning(videoId)) };
}

function isFresh(job: Job): boolean {
  return Date.now() - job.startedAt < JOB_STALE_MS;
}

async function handleDone(jobKey: string, outcome: GeminiOutcome): Promise<void> {
  const job = await updateJobs(async (jobs) => {
    const finished = jobs[jobKey] as Job | undefined;
    delete jobs[jobKey];
    if (Object.keys(jobs).length === 0) await chrome.offscreen.closeDocument().catch(() => undefined);
    return finished;
  });
  if (!job) return;

  let result: AnswerResult;
  if (outcome.ok) {
    await writeCached(jobKey, outcome.answer);
    await addUsedSeconds(secondsForVideo(job.video.durationSeconds, outcome.videoTokens));
    result = { ok: true, answer: outcome.answer, fromCache: false };
  } else {
    result = { ok: false, error: outcome.error };
  }

  const message: TabMessage = { type: 'ANSWER_READY', videoId: job.video.videoId, result };
  await Promise.all(job.tabIds.map((tabId) => chrome.tabs.sendMessage(tabId, message).catch(() => undefined)));
}

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existing.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Keeps a long Gemini request running, because a service worker is stopped after 30 seconds.',
  });
}

function done(result: AnswerResult): RequestReply {
  return { pending: false, result };
}

function failed(error: AnswerError): RequestReply {
  return done({ ok: false, error });
}

function skipped(reason: SkipReason): RequestReply {
  return { pending: false, skipped: reason };
}

chrome.runtime.onMessage.addListener((message: RequestMessage | GeminiDoneMessage, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  switch (message.type) {
    case 'ANSWER_REQUEST':
      handleRequest(message.video, message.force ?? false, sender.tab?.id, message.background ?? false).then(sendResponse, (err) => {
        console.error('Answer request failed', err);
        sendResponse(failed({ code: 'server', message: 'Something went wrong. Try again.' }));
      });
      return true;
    case 'STATUS_REQUEST':
      handleStatus(message.videoIds).then(sendResponse, (err) => {
        console.error('Status request failed', err);
        sendResponse({ ready: [], loading: [] } satisfies StatusReply);
      });
      return true;
    case 'GEMINI_DONE':
      if (sender.tab) return false;
      handleDone(message.jobKey, message.outcome).catch((err) => console.error('Could not finish job', err));
      return false;
    case 'OPEN_OPTIONS':
      chrome.runtime.openOptionsPage();
      return false;
    default:
      return false;
  }
});

// Clicking the toolbar icon answers the video open in this tab, and opens settings anywhere else.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined || !tab.url || !parseVideoId(tab.url)) {
    chrome.runtime.openOptionsPage();
    return;
  }
  const message: TabMessage = { type: 'OPEN_FOR_PAGE' };
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // The tab was open before the extension was installed, so it has no content script yet.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, message);
  }
});

// Keeps the API key out of reach of content scripts.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) chrome.runtime.openOptionsPage();
});
