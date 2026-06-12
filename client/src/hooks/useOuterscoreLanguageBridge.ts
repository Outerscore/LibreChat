import { useCallback, useEffect } from 'react';
import Cookies from 'js-cookie';
import { useRecoilState } from 'recoil';
import { isOuterscoreContext } from '~/hooks/useOuterscoreAutoLogin';
import store from '~/store';

const HOST_LANG_KEY = 'outerscore:lang';
const HOST_LANG_EVENT = 'outerscore:language-changed';

/**
 * Outerscore host language → LibreChat locale. The host supports exactly two
 * languages (EN / DE); anything else is ignored rather than guessed, so a
 * malformed message can never flip the embedded chat to an unintended locale.
 */
const HOST_LANG_TO_LOCALE: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
};

export const mapOuterscoreLanguage = (lang: string): string | null => {
  const base = lang.trim().toLowerCase().split(/[-_]/)[0];
  return HOST_LANG_TO_LOCALE[base] ?? null;
};

/**
 * Keeps the embedded chat's language in lockstep with the Outerscore host.
 * `main.jsx` persists the host-posted language (`outerscore:language`) to
 * sessionStorage and re-dispatches a CustomEvent; this hook applies it to the
 * recoil `lang` atom — the same path the (embedded-hidden) settings selector
 * uses — so i18next, the cookie, and `<html lang>` all follow. Outerscore is
 * the single source of truth for the language while embedded.
 */
export default function useOuterscoreLanguageBridge(): void {
  const [langcode, setLangcode] = useRecoilState(store.lang);

  const applyHostLanguage = useCallback(() => {
    let hostLang = '';
    try {
      hostLang = sessionStorage.getItem(HOST_LANG_KEY) ?? '';
    } catch {
      return;
    }
    const locale = mapOuterscoreLanguage(hostLang);
    if (!locale || locale === langcode) {
      return;
    }
    setLangcode(locale);
    Cookies.set('lang', locale, { expires: 365 });
    requestAnimationFrame(() => {
      document.documentElement.lang = locale;
    });
  }, [langcode, setLangcode]);

  useEffect(() => {
    if (!isOuterscoreContext()) {
      return;
    }
    // Initial sync covers a language posted before React mounted; the event
    // covers runtime EN ↔ DE switches in the host.
    applyHostLanguage();
    window.addEventListener(HOST_LANG_EVENT, applyHostLanguage);
    return () => window.removeEventListener(HOST_LANG_EVENT, applyHostLanguage);
  }, [applyHostLanguage]);
}
