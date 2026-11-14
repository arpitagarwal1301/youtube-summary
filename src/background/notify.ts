import { getSettings } from '../shared/settings';
import { plainText } from '../shared/share';
import type { AnswerResult, TabMessage, VideoRef } from '../shared/types';

const UNSEEN_KEY = 'unseen';
const NOTIFICATION_PREFIX = 'answer:';
const BADGE_COLOR = '#ff7a59';

interface Unseen {
  video: VideoRef;
  tabIds: number[];
}
type UnseenMap = Record<string, Unseen>;

async function readUnseen(): Promise<UnseenMap> {
  const stored = await chrome.storage.session.get(UNSEEN_KEY);
  return (stored[UNSEEN_KEY] ?? {}) as UnseenMap;
}

async function writeUnseen(unseen: UnseenMap): Promise<void> {
  await chrome.storage.session.set({ [UNSEEN_KEY]: unseen });
  const count = Object.keys(unseen).length;
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
}

/**
 * For an answer that arrived with nobody looking at YouTube: counts it on the toolbar icon, and sends a desktop
 * notification unless those are turned off. The count also covers people whose system hides notifications.
 */
export async function announce(video: VideoRef, tabIds: number[], result: AnswerResult): Promise<void> {
  const unseen = await readUnseen();
  unseen[video.videoId] = { video, tabIds };
  await writeUnseen(unseen);

  if (!(await getSettings()).notifications) return;
  const title = video.title || 'Your video';
  await chrome.notifications
    .create(`${NOTIFICATION_PREFIX}${video.videoId}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      // The system cuts the title to one line, so the answer goes in the body where it has room.
      title: result.ok ? title : `Could not answer: ${title}`,
      message: result.ok ? plainText(result.answer.answer) : result.error.message,
    })
    .catch((err) => console.error('Could not show the notification', err));
}

export async function markSeen(videoId?: string): Promise<void> {
  const unseen = await readUnseen();
  const ids = videoId === undefined ? Object.keys(unseen) : videoId in unseen ? [videoId] : [];
  if (ids.length === 0) return;
  for (const id of ids) {
    delete unseen[id];
    chrome.notifications.clear(`${NOTIFICATION_PREFIX}${id}`).catch(() => undefined);
  }
  await writeUnseen(unseen);
}

/** Takes the user to the answer: on the tab that asked if it is still open, otherwise in the panel. */
export async function openFromNotification(notificationId: string): Promise<void> {
  if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;
  const videoId = notificationId.slice(NOTIFICATION_PREFIX.length);
  const target = (await readUnseen())[videoId];
  await markSeen(videoId);

  if (target) {
    const message: TabMessage = { type: 'OPEN_ANSWER', video: target.video };
    for (const tabId of target.tabIds) {
      try {
        const tab = await chrome.tabs.update(tabId, { active: true });
        if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.sendMessage(tabId, message);
        return;
      } catch {
        // That tab has been closed or has moved off YouTube. Try the next one.
      }
    }
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL(`panel.html?tab=1#${videoId}`) });
}
