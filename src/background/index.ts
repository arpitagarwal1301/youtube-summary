import { getRemoteConfig, refreshRemoteConfig } from '../shared/remote';
import { answerKey, findSaved, readSaved, removeOld, writeSaved, savedToday } from '../shared/saved';
import { getSettings, resolveModels, updateSettings, type Settings } from '../shared/settings';
import { shouldOfferAuto, updateStats } from '../shared/stats';
import type {
  AnswerError,
  AnswerResult,
  GeminiDoneMessage,
  GeminiOutcome,
  PageState,
  RequestMessage,
  RequestReply,
  RequestSource,
  RunGeminiMessage,
  SkipReason,
  StatusReply,
  TabMessage,
  VideoRef,
} from '../shared/types';
import {
  AUTO_LIMIT_SECONDS,
  AUTO_MAX_VIDEO_SECONDS,
  DAILY_LIMIT_SECONDS,
  addUsedSeconds,
  describeDuration,
  getUsedSeconds,
  secondsForVideo,
} from '../shared/usage';
import { announce, markSeen, openFromNotification } from './notify';

const OFFSCREEN_PATH = 'offscreen.html';
const PANEL_TAB = 'panel.html?tab=1';
const YOUTUBE_TABS = 'https://www.youtube.com/*';
const JOBS_KEY = 'jobs';
const FAILURES_KEY = 'failures';
/** Slightly longer than the request timeout, so a job lost to a crash cannot block a video forever. */
const JOB_STALE_MS = 5 * 60 * 1000;
/** How long a failure stays on a video, so a second click shows what went wrong instead of quietly starting over. */
const FAILURE_KEPT_MS = 10 * 60 * 1000;

interface Job {
  video: VideoRef;
  tabIds: number[];
  startedAt: number;
  source: RequestSource;
  /** Started by opening a video rather than by a click. Only one of these runs at a time, to stay inside rate limits. */
  auto?: boolean;
  /** Ask, along with the answer, whether to answer opened videos automatically from now on. */
  offerAuto?: boolean;
}
type Jobs = Record<string, Job>;

interface Failure {
  error: AnswerError;
  at: number;
  /** Nobody asked for this one, so it is never shown. It only stops the same video being tried again straight away. */
  auto?: boolean;
}
type Failures = Record<string, Failure>;

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

async function readFailures(now = Date.now()): Promise<Failures> {
  const stored = await chrome.storage.session.get(FAILURES_KEY);
  const failures = (stored[FAILURES_KEY] ?? {}) as Failures;
  return Object.fromEntries(Object.entries(failures).filter(([, failure]) => now - failure.at < FAILURE_KEPT_MS));
}

async function setFailure(jobKey: string, failure: Failure | null): Promise<void> {
  const failures = await readFailures();
  if (failure) failures[jobKey] = failure;
  else if (jobKey in failures) delete failures[jobKey];
  else return;
  await chrome.storage.session.set({ [FAILURES_KEY]: failures });
}

async function launch(jobKey: string, video: VideoRef, settings: Settings, auto: boolean): Promise<void> {
  await ensureOffscreen();
  const { models } = await getRemoteConfig();
  const message: RunGeminiMessage = {
    type: 'RUN_GEMINI',
    jobKey,
    job: {
      video,
      apiKey: settings.apiKey,
      ...resolveModels(settings.model, models),
      language: settings.language,
      ...(auto ? { maxSeconds: AUTO_MAX_VIDEO_SECONDS } : {}),
    },
  };
  await chrome.runtime.sendMessage(message);
}

async function handleRequest(
  message: Extract<RequestMessage, { type: 'ANSWER_REQUEST' }>,
  tabId: number | undefined,
): Promise<RequestReply> {
  const { video, source } = message;
  const auto = source === 'auto';
  const settings = await getSettings();
  const jobKey = answerKey(video.videoId, settings.language);

  // The button on a video's own page gets used a few times before it is worth offering to make it automatic.
  let offerAuto = false;
  if (source === 'page' && !message.force && !message.retry) {
    const stats = await updateStats((current) => void current.pageClicks++);
    offerAuto = shouldOfferAuto(stats, settings.autoAnswer);
  }

  if (!message.force) {
    const saved = await readSaved(jobKey);
    if (saved) return { pending: false, result: { ok: true, answer: saved.answer, fromCache: true }, ...(offerAuto ? { offerAuto } : {}) };
  }
  if (auto && (!settings.autoAnswer || !settings.apiKey || video.isLive)) return skipped('off');
  if (!settings.apiKey) {
    return failed({ code: 'no_key', message: 'Add your free Gemini API key to get answers.' });
  }
  if (video.isLive) {
    return failed({ code: 'unavailable', message: 'Live streams cannot be answered until they have finished.' });
  }

  const failure = (await readFailures())[jobKey] as Failure | undefined;
  if (failure && auto) return skipped('failed');
  if (failure && !failure.auto && !message.force && !message.retry) return failed(failure.error);

  const used = await getUsedSeconds();
  // At or over, because a video with no known length adds nothing here and would otherwise always get through.
  const overDailyLimit = used + (video.durationSeconds ?? 0) >= DAILY_LIMIT_SECONDS;
  if (auto && (overDailyLimit || used + (video.durationSeconds ?? 0) >= AUTO_LIMIT_SECONDS)) return skipped('budget');

  // Starting runs inside the queue, so the offscreen page cannot be closed by a job that just finished.
  return updateJobs(async (jobs): Promise<RequestReply> => {
    const existing = jobs[jobKey] as Job | undefined;
    if (existing && isFresh(existing)) {
      if (tabId !== undefined && !existing.tabIds.includes(tabId)) existing.tabIds.push(tabId);
      // A click on a video being answered automatically makes it the user's own request.
      if (!auto) {
        if (existing.auto) existing.source = source;
        existing.auto = false;
        existing.offerAuto ||= offerAuto;
      }
      return { pending: true, startedAt: existing.startedAt };
    }
    if (overDailyLimit) {
      return failed({
        code: 'daily_limit',
        message: `This would pass the free limit of ${DAILY_LIMIT_SECONDS / 3600} hours of video a day (${describeDuration(used)} used). It resets at midnight Pacific time. Today's answers still open.`,
      });
    }
    if (auto && Object.values(jobs).some((job) => job.auto && isFresh(job))) return skipped('busy');

    try {
      await launch(jobKey, video, settings, auto);
    } catch (err) {
      console.error('Could not start the Gemini request', err);
      return failed({ code: 'server', message: 'Could not start the request. Try again.' });
    }

    await setFailure(jobKey, null);
    const startedAt = Date.now();
    jobs[jobKey] = { video, tabIds: tabId === undefined ? [] : [tabId], startedAt, source, auto, ...(offerAuto ? { offerAuto } : {}) };
    return { pending: true, startedAt };
  });
}

async function handleStatus(videoIds: string[]): Promise<StatusReply> {
  const { language } = await getSettings();
  const keyFor = (videoId: string) => answerKey(videoId, language);

  const saved = await findSaved(videoIds.map(keyFor));
  const stored = await chrome.storage.session.get(JOBS_KEY);
  const jobs = (stored[JOBS_KEY] ?? {}) as Jobs;
  const failures = await readFailures();

  const reply: StatusReply = { ready: [], loading: {}, failed: {} };
  for (const videoId of videoIds) {
    const key = keyFor(videoId);
    const job = jobs[key] as Job | undefined;
    const failure = failures[key] as Failure | undefined;
    if (job && isFresh(job)) reply.loading[videoId] = job.startedAt;
    else if (saved.has(key)) reply.ready.push(videoId);
    else if (failure && !failure.auto) reply.failed[videoId] = failure.error;
  }
  return reply;
}

function isFresh(job: Job): boolean {
  return Date.now() - job.startedAt < JOB_STALE_MS;
}

async function handleDone(jobKey: string, outcome: GeminiOutcome): Promise<void> {
  const job = await updateJobs(async (jobs) => {
    const finished = jobs[jobKey] as Job | undefined;
    if (!finished) return undefined;

    // An automatic request that did not qualify, but which the user has since clicked: now it runs as their own.
    if ('skipped' in outcome && !finished.auto) {
      try {
        await launch(jobKey, finished.video, await getSettings(), false);
        return undefined;
      } catch (err) {
        console.error('Could not restart the request', err);
      }
    }
    delete jobs[jobKey];
    if (Object.keys(jobs).length === 0) await chrome.offscreen.closeDocument().catch(() => undefined);
    return finished;
  });
  if (!job) return;

  let result: AnswerResult;
  let video = job.video;
  if (outcome.ok) {
    video = { ...job.video, ...outcome.video };
    await writeSaved(jobKey, {
      video: {
        videoId: video.videoId,
        title: video.title,
        channel: video.channel,
        durationSeconds: video.durationSeconds,
        isShort: video.isShort,
      },
      answer: outcome.answer,
      savedAt: Date.now(),
      source: job.source,
    });
    await addUsedSeconds(secondsForVideo(video.durationSeconds, outcome.videoTokens));
    await updateStats((stats) => void stats.answers++);
    result = { ok: true, answer: outcome.answer, fromCache: false };
  } else if ('skipped' in outcome) {
    // Remembered so the same video is not tried again on every visit. The page finds out from its next status check.
    await setFailure(jobKey, { error: { code: 'too_long', message: '' }, at: Date.now(), auto: true });
    return;
  } else {
    await setFailure(jobKey, { error: outcome.error, at: Date.now(), auto: job.auto });
    result = { ok: false, error: outcome.error };
  }

  const message: TabMessage = {
    type: 'ANSWER_READY',
    video: { videoId: video.videoId, title: video.title, durationSeconds: video.durationSeconds },
    result,
    source: job.auto ? 'auto' : job.source,
    ...(job.offerAuto && result.ok ? { offerAuto: true } : {}),
  };
  const replies = await Promise.all(
    job.tabIds.map((tabId) => chrome.tabs.sendMessage(tabId, message).catch(() => undefined) as Promise<{ shown?: boolean } | undefined>),
  );
  // An answer nobody asked for is only worth showing to someone already looking at the page.
  if (!job.auto && !replies.some((reply) => reply?.shown)) await announce(message.video, job.tabIds, result);
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

function failed(error: AnswerError): RequestReply {
  return { pending: false, result: { ok: false, error } };
}

function skipped(reason: SkipReason): RequestReply {
  return { pending: false, skipped: reason };
}

async function pageState(): Promise<PageState> {
  const [settings, config] = await Promise.all([getSettings(), getRemoteConfig()]);
  return { hasKey: !!settings.apiKey, autoAnswer: settings.autoAnswer, selectors: config.selectors, shareUrl: config.links.share, sponsorUrl: config.links.sponsor };
}

async function broadcastState(): Promise<void> {
  const message: TabMessage = { type: 'STATE_CHANGED', state: await pageState() };
  const tabs = await chrome.tabs.query({ url: YOUTUBE_TABS });
  await Promise.all(tabs.map((tab) => (tab.id === undefined ? undefined : chrome.tabs.sendMessage(tab.id, message).catch(() => undefined))));
}

/** Opens the toolbar panel, or a tab holding the same page where Chrome will not open the panel by itself. */
async function openPanel(): Promise<void> {
  try {
    await chrome.action.openPopup();
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL(PANEL_TAB) });
  }
}

chrome.runtime.onMessage.addListener((message: RequestMessage | GeminiDoneMessage, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  switch (message.type) {
    case 'ANSWER_REQUEST':
      handleRequest(message, sender.tab?.id).then(sendResponse, (err) => {
        console.error('Answer request failed', err);
        sendResponse(failed({ code: 'server', message: 'Something went wrong. Try again.' }));
      });
      return true;
    case 'STATUS_REQUEST':
      handleStatus(message.videoIds).then(sendResponse, (err) => {
        console.error('Status request failed', err);
        sendResponse({ ready: [], loading: {}, failed: {} } satisfies StatusReply);
      });
      return true;
    case 'GET_STATE':
      pageState().then(sendResponse, () => sendResponse(undefined));
      // A changed file reaches every page through the storage listener below.
      void refreshRemoteConfig();
      return true;
    case 'SET_AUTO':
      void updateSettings({ autoAnswer: message.on === true }).then(() => updateStats((stats) => void (stats.autoOfferDone = true)));
      return false;
    case 'AUTO_OFFER_DONE':
      void updateStats((stats) => void (stats.autoOfferDone = true));
      return false;
    case 'MARK_SEEN':
      void markSeen(message.videoId);
      return false;
    case 'OPEN_PANEL':
      void openPanel();
      return false;
    case 'GET_SAVED_TODAY':
      savedToday().then((seconds) => sendResponse(seconds), () => sendResponse(0));
      return true;
    case 'GEMINI_DONE':
      if (sender.tab) return false;
      handleDone(message.jobKey, message.outcome).catch((err) => console.error('Could not finish job', err));
      return false;
    default:
      return false;
  }
});

chrome.storage.local.onChanged.addListener((changes) => {
  if ('settings' in changes || 'remote' in changes) void broadcastState();
});

chrome.notifications.onClicked.addListener((notificationId) => void openFromNotification(notificationId));

// Keeps the API key out of reach of content scripts.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);

chrome.runtime.onStartup.addListener(() => {
  void removeOld();
  void refreshRemoteConfig();
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  void removeOld();
  void refreshRemoteConfig();
  if (reason !== chrome.runtime.OnInstalledReason.INSTALL) return;

  // YouTube tabs that were already open get the button without a reload.
  const tabs = await chrome.tabs.query({ url: YOUTUBE_TABS });
  for (const tab of tabs) {
    if (tab.id !== undefined) chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => undefined);
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL(`${PANEL_TAB}&welcome=1`) });
});



