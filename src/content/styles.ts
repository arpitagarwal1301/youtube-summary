/** One look shared with the toolbar panel: warm near-black and paper, with the icon's amber-to-coral as the single accent. */
export const STYLES = `
:host { all: initial; }

* { box-sizing: border-box; }

.root {
  --bg: #fbf7f2;
  --text: #1d1816;
  --muted: #6f6259;
  --line: #e6dcd0;
  --chip: #f1e8dd;
  --accent: #b4491f;
  --warn-bg: #fdeccf;
  --warn-text: #7a4300;
  --mark-bg: #ffe3a1;
  --mark-text: #45300a;
  --ink: #211c1a;
  --amber: #ffd166;
  --coral: #ff7a59;
  font-family: Roboto, "Segoe UI", system-ui, -apple-system, Arial, sans-serif;
  color: var(--text);
}

.root.dark {
  --bg: #211c1a;
  --text: #f4ede6;
  --muted: #b3a69b;
  --line: #3d3430;
  --chip: #332b27;
  --accent: #ffb38a;
  --warn-bg: #3f2c12;
  --warn-text: #ffd08a;
  --mark-bg: #5a4212;
  --mark-text: #ffe9b0;
}

button { font: inherit; }

/* ---- Buttons that sit on a video ---- */

.pill, .marker {
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 209, 102, 0.55);
  background: rgba(33, 28, 26, 0.94);
  color: #fff;
  cursor: pointer;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45);
}
.pill {
  display: inline-flex;
  gap: 5px;
  padding: 5px 11px 5px 7px;
  border-radius: 999px;
  font: 500 13px/1 Roboto, "Segoe UI", system-ui, Arial, sans-serif;
  white-space: nowrap;
}
.pill:hover { border-color: var(--amber); background: #2e2520; }
.pill:focus-visible, .marker:focus-visible, .auto:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
.pill[data-status='ready'] { background: #3a2a0c; border-color: var(--amber); }
.pill[data-status='failed'], .marker[data-status='failed'] { border-color: #ff9d8a; }

.know-it { position: fixed; z-index: 2147483646; display: none; }
.know-it.visible { display: inline-flex; }

.marker {
  position: fixed;
  z-index: 2147483645;
  display: inline-flex;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 50%;
}
.marker[data-status='ready'] { background: #3a2a0c; border-color: var(--amber); }

.sparkle { width: 16px; height: 16px; flex: none; }
.failed-mark { display: none; width: 16px; height: 16px; flex: none; border-radius: 50%; background: #ff9d8a; color: #2a1512; font: 700 12px/16px Arial, sans-serif; text-align: center; }

/* Each control holds every icon, and its status decides which one shows. */
.pill .spinner, .marker .spinner, [data-status='loading'] .sparkle, [data-status='failed'] .sparkle { display: none; }
[data-status='loading'] .spinner { display: block; }
[data-status='failed'] .failed-mark { display: block; }

.spinner.small {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: var(--amber);
}

/* ---- The button for the open video, with the automatic switch beside it ---- */

.pagebar { position: absolute; z-index: 2000; display: none; align-items: center; gap: 8px; }
.pagebar.fixed { position: fixed; z-index: 2147483644; }
.pagebar.stacked { flex-direction: column; align-items: flex-start; }
.pagebar.visible { display: inline-flex; }
.pagebar [hidden] { display: none !important; }

.auto {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 9px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--bg);
  color: var(--muted);
  font: 500 12px/1 Roboto, "Segoe UI", system-ui, Arial, sans-serif;
  cursor: pointer;
  white-space: nowrap;
}
.auto:hover { color: var(--text); }
.track { position: relative; width: 26px; height: 16px; border-radius: 999px; background: var(--line); transition: background 0.15s; }
.track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--bg); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12); transition: transform 0.15s; }
.auto[aria-checked='true'] { color: var(--text); border-color: var(--coral); }
.auto[aria-checked='true'] .track { background: linear-gradient(90deg, var(--amber), var(--coral)); }
.auto[aria-checked='true'] .track::after { transform: translateX(10px); }

/* ---- Answer popover ---- */

.popover, .toast, .drawer {
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  line-height: 1.45;
  box-shadow: 0 10px 32px rgba(20, 12, 8, 0.32);
}

.popover {
  position: fixed;
  z-index: 2147483647;
  display: none;
  width: 380px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 14px 16px 12px;
}
.popover.visible { display: block; }

.header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.video-title {
  flex: 1;
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.close {
  flex: none;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.close:hover { background: var(--chip); color: var(--text); }

.answer { margin: 0; font-size: 17px; font-weight: 600; line-height: 1.4; letter-spacing: -0.005em; white-space: pre-wrap; overflow-wrap: anywhere; }

mark {
  /* Shadow instead of padding, so punctuation right after a highlight does not look spaced out. */
  padding: 0;
  border-radius: 2px;
  box-shadow: 0 0 0 2px var(--mark-bg);
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  background: var(--mark-bg);
  color: var(--mark-text);
  font-weight: 600;
}

.points { margin: 12px 0 0; padding: 0 0 0 16px; color: var(--muted); font-size: 13.5px; line-height: 1.5; }
.points li { margin-bottom: 6px; padding-left: 2px; overflow-wrap: anywhere; }
.points strong, .summary strong { color: var(--text); font-weight: 600; }
.points li:last-child { margin-bottom: 0; }
.points li::marker, .summary li::marker { color: var(--coral); }

.caution { display: flex; gap: 6px; margin: 12px 0 0; color: var(--warn-text); font-size: 12.5px; line-height: 1.45; }
.caution::before { content: '!'; flex: none; display: grid; place-items: center; width: 16px; height: 16px; margin-top: 1px; border-radius: 50%; background: var(--warn-bg); font-size: 11px; font-weight: 700; }

a, .link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}
a:hover, .link:hover { text-decoration: underline; }

.primary {
  padding: 6px 14px;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--amber), var(--coral));
  color: var(--ink);
  font-weight: 600;
  cursor: pointer;
}

.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin: 12px -8px 0; }
.action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font: 500 13px/1 Roboto, "Segoe UI", system-ui, Arial, sans-serif;
  text-decoration: none;
  cursor: pointer;
}
.action:hover { background: var(--chip); color: var(--text); text-decoration: none; }
.action.icon-only { margin-left: auto; padding: 0 8px; }
.action .icon-play { fill: currentColor; }
.action .line-icon { width: 16px; height: 16px; flex: none; }
.action.toggle .line-icon { transition: transform 0.15s; }
.action.toggle[aria-expanded='true'] .line-icon { transform: rotate(180deg); }
.action .icon-check { color: var(--coral); }

.popover-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); font-size: 12.5px; }
.saved { color: var(--muted); font-weight: 400; }
.saved strong { color: var(--text); font-weight: 600; }
.popover-footer .line-icon { width: 15px; height: 15px; flex: none; }
.link.quiet, .sponsor { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-weight: 500; }
.link.quiet:hover { color: var(--text); text-decoration: none; }
.sponsor:hover { color: var(--text); text-decoration: none; }
.sponsor .line-icon { color: var(--coral); fill: var(--coral); }

/* ---- Know It's own button in YouTube's top bar, and today's answers below it ---- */

.topbar-button {
  position: fixed;
  z-index: 2147483645;
  display: none;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.05);
  cursor: pointer;
}
.topbar-button.visible { display: grid; place-items: center; }
.topbar-button:hover, .topbar-button[aria-expanded='true'] { background: rgba(0, 0, 0, 0.1); }
.root.dark .topbar-button { background: rgba(255, 255, 255, 0.08); }
.root.dark .topbar-button:hover, .root.dark .topbar-button[aria-expanded='true'] { background: rgba(255, 255, 255, 0.16); }
.topbar-button .sparkle { width: 22px; height: 22px; }
.topbar-button .dot { position: absolute; top: 6px; right: 6px; display: none; width: 9px; height: 9px; border: 2px solid var(--page, #fff); border-radius: 50%; background: var(--coral); }
.root.dark .topbar-button .dot { border-color: #0f0f0f; }
.topbar-button.unseen .dot { display: block; }
.topbar-button:focus-visible { outline: 2px solid var(--coral); outline-offset: 2px; }

.drawer { position: fixed; z-index: 2147483646; display: none; overflow: hidden; padding: 0; }
.drawer.visible { display: block; }
.drawer-frame { display: block; width: 100%; height: 100%; border: 0; background: var(--bg); }

.summary { margin: 6px 0 0; padding: 10px 0 0 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13.5px; line-height: 1.5; }
.summary li { margin-bottom: 6px; overflow-wrap: anywhere; }
.summary li:last-child { margin-bottom: 0; }

.offer { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.offer p { margin: 0; }
.offer .hint { margin-top: 4px; }

.loading { display: flex; align-items: center; gap: 10px; }
.spinner {
  flex: none;
  width: 18px;
  height: 18px;
  border: 2px solid var(--line);
  border-top-color: var(--coral);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 4s; } .track, .track::after { transition: none; } }
.hint { margin: 8px 0 0; color: var(--muted); font-size: 13px; }

.error { margin: 0; }

.setup-lead { margin: 0; font-size: 15.5px; font-weight: 500; }
.setup-hint { margin: 4px 0 10px; }
.setup-frame { display: block; width: 100%; height: 178px; border: 0; background: transparent; color-scheme: normal; }

/* ---- Answers that arrive while the user is somewhere else on the page ---- */

.toasts { position: fixed; z-index: 2147483646; top: 68px; right: 16px; display: flex; flex-direction: column; gap: 8px; width: 340px; max-width: calc(100vw - 32px); }
.toast { position: relative; padding: 12px 34px 12px 40px; cursor: pointer; animation: arrive 0.18s ease-out; }
.toast:hover { border-color: var(--coral); }
.toast .sparkle, .toast .failed-mark { position: absolute; top: 14px; left: 14px; }
.toast.failed .failed-mark { display: block; }
.toast.failed .sparkle { display: none; }
.toast-text { margin: 0; font-weight: 500; overflow-wrap: anywhere; }
.toast-title { margin: 4px 0 0; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.toast-more { display: inline-block; margin-top: 6px; font-size: 13px; }
.toast .close { position: absolute; top: 8px; right: 8px; }
@keyframes arrive { from { opacity: 0; transform: translateY(-6px); } }
@media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
`;
