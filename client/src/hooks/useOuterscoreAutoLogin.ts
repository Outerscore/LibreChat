import { useEffect, useRef, useState } from 'react';
import { dataService } from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';
import {
  getOuterscoreToken,
  clearOuterscoreToken,
} from '~/utils/outerscoreToken';

const PAGE_STORAGE_KEY = 'outerscore:page';
const TOKEN_READY_EVENT = 'outerscore:token-ready';
const LOGOUT_EVENT = 'outerscore:logout';

const readToken = (): string | null => getOuterscoreToken();

const isInIframe = (): boolean => typeof window !== 'undefined' && window.parent !== window;

export const isOuterscoreContext = (): boolean => {
  if (!isInIframe()) return false;
  try {
    return !!sessionStorage.getItem(PAGE_STORAGE_KEY) || !!getOuterscoreToken();
  } catch {
    return !!getOuterscoreToken();
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

const decodeJwtSub = (token: string): string | null => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json?.sub === 'string' ? json.sub : null;
  } catch {
    return null;
  }
};

export interface UseOuterscoreAutoLoginArgs {
  isAuthenticated: boolean;
  currentUserId?: string;
  onSuccess: (data: t.TLoginResponse) => void;
  onUserSwitch?: () => void;
}

export interface UseOuterscoreAutoLoginResult {
  enabled: boolean;
  pending: boolean;
}

export default function useOuterscoreAutoLogin({
  isAuthenticated,
  currentUserId,
  onSuccess,
  onUserSwitch,
}: UseOuterscoreAutoLoginArgs): UseOuterscoreAutoLoginResult {
  const enabled = isOuterscoreContext();
  const lastBridgedTokenRef = useRef<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const onUserSwitchRef = useRef(onUserSwitch);
  const currentUserIdRef = useRef<string | undefined>(currentUserId);
  const [pending, setPending] = useState<boolean>(enabled);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    onUserSwitchRef.current = onUserSwitch;
  }, [onUserSwitch]);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    if (!enabled) {
      setPending(false);
      return;
    }

    const runBridge = (token: string) => {
      if (lastBridgedTokenRef.current === token) {
        setPending(false);
        return;
      }

      const incomingSub = decodeJwtSub(token);
      const knownUserId = currentUserIdRef.current;
      if (knownUserId && incomingSub && knownUserId !== incomingSub) {
        onUserSwitchRef.current?.();
      }

      lastBridgedTokenRef.current = token;
      setPending(true);
      dataService
        .outerscoreBridge(token)
        .then((data) => {
          setPending(false);
          postToParent({ type: 'outerscore:auth-success' });
          onSuccessRef.current(data);
        })
        .catch((err: unknown) => {
          setPending(false);
          clearOuterscoreToken();
          postToParent({ type: 'outerscore:auth-required' });
          console.warn('[outerscore] auto-login failed:', err);
        });
    };

    const tryBridgeWithCurrentToken = () => {
      const token = readToken();
      if (token && token !== lastBridgedTokenRef.current) {
        runBridge(token);
      }
    };

    const handleTokenReady = () => {
      tryBridgeWithCurrentToken();
    };

    const handleLogout = () => {
      lastBridgedTokenRef.current = null;
      setPending(true);
    };

    window.addEventListener(TOKEN_READY_EVENT, handleTokenReady);
    window.addEventListener(LOGOUT_EVENT, handleLogout);

    const initialToken = readToken();
    if (initialToken) {
      runBridge(initialToken);
    } else {
      postToParent({ type: 'outerscore:auth-required' });
    }

    return () => {
      window.removeEventListener(TOKEN_READY_EVENT, handleTokenReady);
      window.removeEventListener(LOGOUT_EVENT, handleLogout);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (isAuthenticated) {
      setPending(false);
    }
  }, [enabled, isAuthenticated]);

  return { enabled, pending };
}
