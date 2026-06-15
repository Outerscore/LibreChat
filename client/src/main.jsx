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
import { clearCanvasDocIds } from './utils/canvas';
import 'katex/dist/katex.min.css';
import 'katex/dist/contrib/copy-tex.js';

try {
  const params = new URLSearchParams(window.location.search);
  const osPage = params.get('os_page');
  if (osPage) {
    sessionStorage.setItem('outerscore:page', osPage);
  }

  // The Outerscore feature the assistant was launched from, as an agent-category
  // value (see `getAgentCategory` in utils/outerscoreAgentCategory). Stored so the
  // marketplace / agent picker can scope to the feature's agents. Mirrors os_page.
  const osCategory = params.get('os_category');
  if (osCategory) {
    sessionStorage.setItem('outerscore:agent-category', osCategory);
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
    // Marks the embedded context for re-skin CSS that should only apply in the
    // host iframe (e.g. tightening the composer's bottom margin now the footer is
    // hidden). Scopes those rules without touching standalone LibreChat.
    document.documentElement.classList.add('os-embedded');

    const parentOrigin = import.meta.env.VITE_OUTERSCORE_PARENT_ORIGIN || '';
    if (!parentOrigin) {
      // Build-time var (inlined by Vite). Unset means the postMessage bridge
      // trusts ANY embedder for inbound messages (incl. fake SSO tokens) and
      // posts to '*' outbound — acceptable only for local dev. Surface it loudly
      // so a deployment that forgot the --build-arg can't ship silently.
      console.error(
        '[outerscore] VITE_OUTERSCORE_PARENT_ORIGIN is not set — the iframe will accept ' +
          'postMessage from any origin and post to "*". This is unsafe; set it at build time ' +
          '(docker build --build-arg VITE_OUTERSCORE_PARENT_ORIGIN=…) for any non-local deployment.',
      );
    }

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
        // The host owns the live palette; mirror its --os-* values as inline
        // CSS variables so the embedded chat matches the running app (and any
        // runtime cosmic/classic theme switch). Inline :root vars override
        // outerscore-tokens.css.
        const root = document.documentElement;
        Object.entries(data.vars).forEach(([name, value]) => {
          if (
            typeof name === 'string' &&
            (name.startsWith('--os-color-') || name.startsWith('--os-text-')) &&
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
      if (data.type === 'outerscore:language' && typeof data.lang === 'string') {
        // The host app language ('en' | 'de'). Persisted for the React-side
        // bridge (which maps it to a LibreChat locale and applies it), plus a
        // CustomEvent for runtime switches after React has mounted.
        try {
          sessionStorage.setItem('outerscore:lang', data.lang);
        } catch {
          /* ignore */
        }
        window.dispatchEvent(new CustomEvent('outerscore:language-changed'));
      }
      if (data.type === 'outerscore:logout') {
        clearOuterscoreToken();
        clearCanvasDocIds();
        try {
          sessionStorage.removeItem('outerscore:canvas-content');
        } catch {
          /* ignore */
        }
        window.dispatchEvent(new CustomEvent('outerscore:logout'));
      }
    });

    try {
      // Pin the handshake to the configured host origin in production; '*'
      // remains only as the unconfigured-dev fallback.
      window.parent.postMessage({ type: 'outerscore:ready' }, parentOrigin || '*');
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
