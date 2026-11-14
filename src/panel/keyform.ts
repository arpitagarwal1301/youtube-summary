import { GEMINI_BASE } from '../background/gemini';
import { getSettings, updateSettings } from '../shared/settings';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function testKey(apiKey: string): Promise<'ok' | 'rejected' | 'unreachable'> {
  try {
    const response = await fetch(`${GEMINI_BASE}/v1beta/models?pageSize=1`, { headers: { 'x-goog-api-key': apiKey } });
    return response.ok ? 'ok' : 'rejected';
  } catch {
    return 'unreachable';
  }
}

/**
 * The two steps to get and save a Gemini key. Used in the toolbar panel and in the frame shown on YouTube, both of
 * which are the extension's own pages, so nothing on a website can read the key as it is typed.
 */
export function renderKeyForm(container: HTMLElement, getKeyUrl: string, onSaved: () => void): void {
  const steps = el('ol', 'steps');

  const first = el('li');
  const get = el('a', 'button', 'Get your free key');
  get.href = getKeyUrl;
  get.target = '_blank';
  get.rel = 'noopener noreferrer';
  first.append(get, el('span', 'help', 'Opens Google AI Studio. Sign in, press Create API key, then copy it.'));

  const second = el('li');
  const row = el('div', 'key-row');
  const input = el('input');
  input.type = 'password';
  input.placeholder = 'Paste the key here';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Gemini API key');
  const save = el('button', 'primary', 'Save and test');
  save.type = 'button';
  row.append(input, save);
  const status = el('p', 'key-status');
  status.setAttribute('role', 'status');
  second.append(row, status);

  steps.append(first, second);
  container.replaceChildren(steps);

  const submit = async (): Promise<void> => {
    const apiKey = input.value.trim();
    if (!apiKey) {
      status.textContent = 'Paste your key first.';
      status.className = 'key-status bad';
      return;
    }
    save.disabled = true;
    status.className = 'key-status';
    status.textContent = 'Testing…';
    const outcome = await testKey(apiKey);
    save.disabled = false;
    if (outcome === 'rejected') {
      status.textContent = 'Google did not accept this key. Copy it again and retry.';
      status.className = 'key-status bad';
      return;
    }
    // A key that could not be tested is still saved: the first answer will show whether it works.
    await updateSettings({ apiKey });
    status.textContent = outcome === 'ok' ? 'Saved. The key works.' : 'Saved, but Google could not be reached to test it.';
    status.className = outcome === 'ok' ? 'key-status good' : 'key-status';
    onSaved();
  };
  save.addEventListener('click', () => void submit());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void submit();
  });
}

export async function maskedKey(): Promise<string> {
  const { apiKey } = await getSettings();
  return apiKey ? `••••••${apiKey.slice(-4)}` : '';
}
