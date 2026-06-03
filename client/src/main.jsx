import 'regenerator-runtime/runtime';
import { createRoot } from 'react-dom/client';
import './locales/i18n';
import App from './App';
import './style.css';
import './mobile.css';
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
