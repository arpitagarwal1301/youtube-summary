import { renderKeyForm } from '../panel/keyform';
import { getRemoteConfig } from '../shared/remote';

// Shown inside the answer popover on YouTube. It follows YouTube's theme rather than the system's.
const theme = new URLSearchParams(location.search).get('theme');
document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';

void getRemoteConfig().then(({ links }) => {
  // Saving the key is all that is needed here: the page on YouTube hears about it and answers the video that was clicked.
  renderKeyForm(document.getElementById('form')!, links.getKey, () => undefined);
});
