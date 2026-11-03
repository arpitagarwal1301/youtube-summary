// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findVideoAt, findVisibleVideos, readCurrentPageVideo } from '../src/content/card';

const ID = 'dQw4w9WgXcQ';

function render(html: string): void {
  document.body.innerHTML = html;
}

function at(selector: string): Element {
  return document.querySelector(selector)!;
}

const lockup = (href: string, badge = '6:16') => `
  <ytd-rich-item-renderer>
    <yt-lockup-view-model>
      <a href="${href}" class="thumb" aria-label="Aria title">
        <yt-thumbnail-view-model><img alt=""><badge-shape><div>${badge}</div></badge-shape></yt-thumbnail-view-model>
      </a>
      <div class="meta">
        <h3><a href="${href}" title="The real headline"><span>The real headline</span></a></h3>
        <a href="/@homes4u"><img></a>
        <a href="/@homes4u">HOMES4U</a>
      </div>
    </yt-lockup-view-model>
  </ytd-rich-item-renderer>`;

beforeEach(() => render(''));

describe('findVideoAt', () => {
  it('reads a home feed card from anywhere inside it', () => {
    render(lockup(`/watch?v=${ID}`));
    for (const selector of ['img', 'h3 span', '.meta']) {
      const found = findVideoAt(at(selector));
      expect(found?.video).toEqual({
        videoId: ID,
        title: 'The real headline',
        channel: 'HOMES4U',
        durationSeconds: 376,
      });
      expect(found?.thumbnail).toBe(at('a.thumb'));
    }
  });

  it('reads the first video from a Mix', () => {
    render(lockup(`/watch?v=${ID}&list=RD${ID}&start_radio=1`, 'Mix'));
    const video = findVideoAt(at('img'))?.video;
    expect(video?.videoId).toBe(ID);
    expect(video?.durationSeconds).toBeUndefined();
  });

  it('reads a Short', () => {
    render(`<ytm-shorts-lockup-view-model>
      <a href="/shorts/${ID}" title="Short headline"><img></a>
      <h3><a href="/shorts/${ID}">Short headline</a></h3>
    </ytm-shorts-lockup-view-model>`);
    expect(findVideoAt(at('img'))?.video).toMatchObject({ videoId: ID, title: 'Short headline' });
  });

  it('marks a live stream from its thumbnail badge', () => {
    render(lockup(`/watch?v=${ID}`, 'LIVE'));
    expect(findVideoAt(at('img'))?.video.isLive).toBe(true);
  });

  it('is not fooled by a LIVE badge on the channel avatar', () => {
    render(`<ytd-rich-item-renderer>
      <a href="/watch?v=${ID}"><img><span>22:14</span></a>
      <a href="/@ndtv"><img><span>LIVE</span></a>
      <h3>Headline</h3>
    </ytd-rich-item-renderer>`);
    const video = findVideoAt(at('img'))?.video;
    expect(video?.isLive).toBeUndefined();
    expect(video?.durationSeconds).toBe(1334);
  });

  it('marks a live stream from markers outside the thumbnail link, as search results have them', () => {
    render(`<ytd-video-renderer>
      <ytd-thumbnail is-live-video><a id="thumbnail" href="/watch?v=${ID}"><img></a></ytd-thumbnail>
      <a id="video-title" title="Headline" href="/watch?v=${ID}"></a>
    </ytd-video-renderer>`);
    expect(findVideoAt(at('img'))?.video.isLive).toBe(true);

    render(`<ytd-video-renderer>
      <ytd-thumbnail><a id="thumbnail" href="/watch?v=${ID}"><img></a></ytd-thumbnail>
      <badge-shape class="ytBadgeShapeHost ytBadgeShapeLive" aria-label="LIVE"><div>LIVE</div></badge-shape>
    </ytd-video-renderer>`);
    expect(findVideoAt(at('img'))?.video.isLive).toBe(true);
  });

  it('does not treat a LIVE ring on the avatar as a live video, even with no duration', () => {
    render(`<yt-lockup-view-model>
      <a href="/watch?v=${ID}&list=RD${ID}"><img></a>
      <div class="yt-spec-avatar-shape"><badge-shape aria-label="LIVE"><div>LIVE</div></badge-shape></div>
    </yt-lockup-view-model>`);
    expect(findVideoAt(at('img'))?.video.isLive).toBeUndefined();
  });

  it('a duration wins over any live marker', () => {
    render(`<ytd-video-renderer>
      <ytd-thumbnail is-live-video><a href="/watch?v=${ID}"><img><span>13:49</span></a></ytd-thumbnail>
    </ytd-video-renderer>`);
    const video = findVideoAt(at('img'))?.video;
    expect(video?.isLive).toBeUndefined();
    expect(video?.durationSeconds).toBe(829);
  });

  it('reads the older video renderer', () => {
    render(`<ytd-video-renderer>
      <ytd-thumbnail><a id="thumbnail" href="/watch?v=${ID}"><yt-image><img></yt-image></a></ytd-thumbnail>
      <a id="video-title" title="Old layout headline" href="/watch?v=${ID}"></a>
      <ytd-channel-name><span id="text"> Old Channel </span></ytd-channel-name>
    </ytd-video-renderer>`);
    expect(findVideoAt(at('img'))?.video).toMatchObject({ title: 'Old layout headline', channel: 'Old Channel' });
  });

  it('works on a thumbnail link outside any known card', () => {
    render(`<div><a href="/watch?v=${ID}" aria-label="Fallback title"><img></a></div>`);
    expect(findVideoAt(at('img'))?.video).toMatchObject({ videoId: ID, title: 'Fallback title' });
  });

  it('ignores text links, playlists, channels and ads', () => {
    render(`<a id="text" href="/watch?v=${ID}">A link in a description</a>`);
    expect(findVideoAt(at('#text'))).toBeNull();

    render(`<yt-lockup-view-model><a href="/playlist?list=PL1"><img></a></yt-lockup-view-model>`);
    expect(findVideoAt(at('img'))).toBeNull();

    render(`<a href="/@channel"><img></a>`);
    expect(findVideoAt(at('img'))).toBeNull();

    render(`<ytd-ad-slot-renderer>${lockup(`/watch?v=${ID}`)}</ytd-ad-slot-renderer>`);
    expect(findVideoAt(at('img'))).toBeNull();
  });
});

describe('findVisibleVideos', () => {
  const OTHER = 'aaaaaaaaaaa';

  /** Places each card's elements using its data-top attribute, because jsdom has no layout. */
  function layOut(): void {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const top = Number(this.closest('[data-top]')?.getAttribute('data-top') ?? 0);
      return { top, bottom: top + 200, left: 0, right: 300, width: 300, height: 200, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
  }

  const card = (id: string, top: number) => `<ytd-rich-item-renderer data-top="${top}">
    <yt-lockup-view-model><a href="/watch?v=${id}"><img><span>5:00</span></a><h3>Headline ${id}</h3></yt-lockup-view-model>
  </ytd-rich-item-renderer>`;

  afterEach(() => vi.restoreAllMocks());

  it('lists on-screen videos, top first, once each despite nested card elements', () => {
    render(card(ID, 0) + card(OTHER, 300));
    layOut();
    expect(findVisibleVideos(document, 1000, 800).map((found) => found.video.videoId)).toEqual([ID, OTHER]);
  });

  it('leaves out videos above and below the screen', () => {
    render(card(ID, -500) + card(OTHER, 900));
    layOut();
    expect(findVisibleVideos(document, 1000, 800)).toEqual([]);
  });

  it('needs at least half of the thumbnail on screen', () => {
    render(card(ID, 750) + card(OTHER, 650));
    layOut();
    expect(findVisibleVideos(document, 1000, 800).map((found) => found.video.videoId)).toEqual([OTHER]);
  });

  it('marks Shorts', () => {
    render(`<ytm-shorts-lockup-view-model data-top="0"><a href="/shorts/${ID}"><img></a></ytm-shorts-lockup-view-model>`);
    layOut();
    expect(findVisibleVideos(document, 1000, 800)[0].video.isShort).toBe(true);
  });
});

describe('readCurrentPageVideo', () => {
  it('reads a watch page', () => {
    render(`<ytd-watch-metadata><h1> Page headline </h1></ytd-watch-metadata>
      <div id="owner"><ytd-channel-name><a>Page Channel</a></ytd-channel-name></div>`);
    expect(readCurrentPageVideo(document, `https://www.youtube.com/watch?v=${ID}`)).toEqual({
      videoId: ID,
      title: 'Page headline',
      channel: 'Page Channel',
    });
  });

  it('falls back to the document title', () => {
    document.title = 'Tab headline - YouTube';
    expect(readCurrentPageVideo(document, `https://www.youtube.com/shorts/${ID}`)?.title).toBe('Tab headline');
  });

  it('returns null away from a video', () => {
    expect(readCurrentPageVideo(document, 'https://www.youtube.com/')).toBeNull();
  });
});
