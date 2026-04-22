import { useEffect, useRef, useState } from 'react';
import { dataService } from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';

const TOKEN_STORAGE_KEY = 'outerscore:token';
const PAGE_STORAGE_KEY = 'outerscore:page';

const readToken = (): string | null => {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
};

const isInIframe = (): boolean => typeof window !== 'undefined' && window.parent !== window;

const isOuterscoreContext = (): boolean => {
  if (!isInIframe()) return false;
  try {
    return !!sessionStorage.getItem(PAGE_STORAGE_KEY) || !!sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return false;
  }
};

const postToParent = (message: { type: string; [key: string]: unknown }) => {
  if (!isInIframe()) return;
  try {
    window.parent.postMessage(message, '*');
  } catch {
    /* ignore */
  }
};

export interface UseOuterscoreAutoLoginArgs {
  isAuthenticated: boolean;
  onSuccess: (data: t.TLoginResponse) => void;
}

export interface UseOuterscoreAutoLoginResult {
  enabled: boolean;
  pending: boolean;
}

export default function useOuterscoreAutoLogin({
  isAuthenticated,
  onSuccess,
}: UseOuterscoreAutoLoginArgs): UseOuterscoreAutoLoginResult {
  const enabled = isOuterscoreContext();
  const attemptedRef = useRef(false);
  const [pending, setPending] = useState<boolean>(enabled);

  useEffect(() => {
    if (!enabled) {
      setPending(false);
      return;
    }
    if (isAuthenticated) {
      setPending(false);
      return;
    }
    if (attemptedRef.current) {
      return;
    }
    const token = readToken();
    if (!token) {
      setPending(false);
      postToParent({ type: 'outerscore:auth-required' });
      return;
    }
    attemptedRef.current = true;
    setPending(true);

    dataService
      .outerscoreBridge(token)
      .then((data) => {
        setPending(false);
        postToParent({ type: 'outerscore:auth-success' });
        onSuccess(data);
      })
      .catch((err: unknown) => {
        setPending(false);
        try {
          sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        postToParent({ type: 'outerscore:auth-required' });
        console.warn('[outerscore] auto-login failed:', err);
      });
  }, [enabled, isAuthenticated, onSuccess]);

  return { enabled, pending };
}
