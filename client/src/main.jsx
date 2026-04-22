import 'regenerator-runtime/runtime';
import { createRoot } from 'react-dom/client';
import './locales/i18n';
import App from './App';
import './style.css';
import './mobile.css';
import { ApiErrorBoundaryProvider } from './hooks/ApiErrorBoundaryContext';
import 'katex/dist/katex.min.css';
import 'katex/dist/contrib/copy-tex.js';

try {
  const params = new URLSearchParams(window.location.search);
  const osPage = params.get('os_page');
  const osToken = params.get('os_token');
  if (osPage) {
    sessionStorage.setItem('outerscore:page', osPage);
  }
  if (osToken) {
    sessionStorage.setItem('outerscore:token', osToken);
  }
  if (window.parent !== window) {
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'outerscore:handshake' && typeof data.token === 'string') {
        try {
          sessionStorage.setItem('outerscore:token', data.token);
        } catch {
          /* ignore */
        }
      }
    });
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
