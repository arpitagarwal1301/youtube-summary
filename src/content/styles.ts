export const STYLES = `
:host { all: initial; }

* { box-sizing: border-box; }

.root {
  --bg: #ffffff;
  --text: #0f0f0f;
  --muted: #606060;
  --line: #e5e5e5;
  --chip: #f2f2f2;
  --accent: #065fd4;
  --warn-bg: #fff4e5;
  --warn-text: #8a4b00;
  --mark-bg: #fff0b8;
  --mark-text: #4a3500;
  font-family: Roboto, Arial, sans-serif;
  color: var(--text);
}

.root.dark {
  --bg: #212121;
  --text: #f1f1f1;
  --muted: #aaaaaa;
  --line: #3f3f3f;
  --chip: #3a3a3a;
  --accent: #6ea8ff;
  --warn-bg: #3d2c12;
  --warn-text: #ffcf8a;
  --mark-bg: #5a4510;
  --mark-text: #ffe9a8;
}

.know-it, .marker {
  position: fixed;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 209, 102, 0.55);
  background: rgba(15, 15, 15, 0.92);
  color: #fff;
  cursor: pointer;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
}

.know-it {
  z-index: 2147483646;
  display: none;
  gap: 5px;
  padding: 5px 11px 5px 7px;
  border-radius: 999px;
  font: 500 13px/1 Roboto, Arial, sans-serif;
}
.know-it:hover { border-color: #ffd166; background: #2a2118; }
.know-it:focus-visible, .marker:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
.know-it.visible { display: inline-flex; }
.know-it[data-status='ready'] { background: #3a2a0c; border-color: #ffd166; }

.marker {
  z-index: 2147483645;
  display: inline-flex;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 50%;
}
.marker[data-status='ready'] { background: #3a2a0c; border-color: #ffd166; }

.sparkle { width: 16px; height: 16px; flex: none; }

/* Each control holds both icons, and its status decides which one shows. */
.know-it .spinner, .marker .spinner, [data-status='loading'] .sparkle { display: none; }
[data-status='loading'] .spinner { display: block; }

.spinner.small {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffd166;
}

.popover {
  position: fixed;
  z-index: 2147483647;
  display: none;
  width: 380px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 14px 16px 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  line-height: 1.45;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
}
.popover.visible { display: block; }

.header { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 10px; }
.video-title {
  flex: 1;
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
  display: -webkit-box;
  -webkit-line-clamp: 2;
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

.question { margin: 0 0 4px; color: var(--muted); font-size: 13px; }
.answer { margin: 0; font-size: 15px; font-weight: 500; white-space: pre-wrap; overflow-wrap: anywhere; }

mark {
  padding: 0 3px;
  border-radius: 3px;
  background: var(--mark-bg);
  color: var(--mark-text);
  font-weight: 600;
}

.points { margin: 10px 0 0; padding: 0 0 0 18px; }
.points li { margin-bottom: 6px; overflow-wrap: anywhere; }
.points li:last-child { margin-bottom: 0; }

.warning {
  margin: 10px 0 0;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--warn-bg);
  color: var(--warn-text);
  font-size: 13px;
}

.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 12px; }
.chip {
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--chip);
  color: var(--text);
  font-size: 12px;
}

.evidence { display: block; margin-top: 10px; font-size: 13px; }

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

.actions { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 12px; font-size: 13px; }

.summary { margin: 10px 0 0; padding: 10px 0 0 18px; border-top: 1px solid var(--line); }
.summary li { margin-bottom: 6px; overflow-wrap: anywhere; }
.summary li:last-child { margin-bottom: 0; }

.loading { display: flex; align-items: center; gap: 10px; }
.spinner {
  flex: none;
  width: 18px;
  height: 18px;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 4s; } }
.hint { margin: 8px 0 0; color: var(--muted); font-size: 13px; }

.error { margin: 0; }
`;
