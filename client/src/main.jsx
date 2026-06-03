import 'regenerator-runtime/runtime';
import { createRoot } from 'react-dom/client';
import './locales/i18n';
import App from './App';
import './style.css';
import './mobile.css';
// Outerscore design-system alignment — vendored --os-* tokens + a remap of
// LibreChat's semantic CSS variables onto them. Imported AFTER style.css so the
// :root overrides win. Re-skin only (colours/fonts), no layout change.
import './style/outerscore-tokens.css';
import './style/outerscore.css';
import { ApiErrorBoundaryProvider } from './hooks/ApiErrorBoundaryContext';
import { setOuterscoreToken, clearOuterscoreToken } from './utils/outerscoreToken';
import 'katex/dist/katex.min.css';
import 'katex/dist/contrib/copy-tex.js';

try {
  const params = new URLSearchParams(window.location.search);
  const osPage = params.get('os_page');
  if (osPage) {
    sessionStorage.setItem('outerscore:page', osPage);
  }

  if (window.parent !== window) {
    // Pin theme to light when embedded — the chat follows the Outerscore host
    // palette, so any LibreChat dark-mode class would fight the re-skin. The
    // inline script in index.html does the same write before ThemeContext
    // boots; this is the belt-and-suspenders strip after React has loaded.
    try {
      localStorage.setItem('color-theme', 'light');
    } catch {
      /* ignore */
    }
    document.documentElement.classList.remove('dark');

    const parentOrigin = import.meta.env.VITE_OUTERSCORE_PARENT_ORIGIN || '';

    window.addEventListener('message', (event) => {
      if (parentOrigin && event.origin !== parentOrigin) {
        return;
      }
      const data = event.data;
      if (!data || typeof data !== 'object') {
        return;
      }
      if (data.type === 'outerscore:handshake' && typeof data.token === 'string') {
        setOuterscoreToken(data.token);
        window.dispatchEvent(new CustomEvent('outerscore:token-ready'));
      }
      if (data.type === 'outerscore:theme' && data.vars && typeof data.vars === 'object') {
        // The host owns the live palette; mirror its --color-* values as inline
        // CSS variables so the embedded chat matches the running app (and any
        // runtime theme switch). Inline :root vars override outerscore-tokens.css.
        const root = document.documentElement;
        Object.entries(data.vars).forEach(([name, value]) => {
          if (
            typeof name === 'string' &&
            name.startsWith('--color-') &&
            typeof value === 'string' &&
            value
          ) {
            root.style.setProperty(name, value);
          }
        });
      }
      if (data.type === 'outerscore:canvas-context' && typeof data.content === 'string') {
        try {
          sessionStorage.setItem('outerscore:canvas-content', data.content);
        } catch {
          /* ignore */
        }
      }
      if (data.type === 'outerscore:logout') {
        clearOuterscoreToken();
        try {
          sessionStorage.removeItem('outerscore:canvas-content');
        } catch {
          /* ignore */
        }
        window.dispatchEvent(new CustomEvent('outerscore:logout'));
      }
    });

    try {
      window.parent.postMessage({ type: 'outerscore:ready' }, '*');
    } catch {
      /* ignore */
    }
  }
} catch {
  /* sessionStorage unavailable — safe to ignore */
}

const container = document.getElementById('root');
const root = createRoot(container);

root.render(
  <ApiErrorBoundaryProvider>
    <App />
  </ApiErrorBoundaryProvider>,
);
