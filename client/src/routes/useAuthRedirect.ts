import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { buildLoginRedirectUrl } from 'librechat-data-provider';
import { isOuterscoreContext } from '~/hooks/useOuterscoreAutoLogin';
import { useAuthContext } from '~/hooks';

export default function useAuthRedirect() {
  const { user, roles, isAuthenticated } = useAuthContext();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // In the Outerscore embed there is no interactive login — the host bridges
    // auth via postMessage (useOuterscoreAutoLogin). Bouncing to /login here
    // would race that async bridge and replace a deep-linked /c/<id> (a restored
    // conversation) with the login URL before auth lands. Let auto-login own
    // auth; ChatRoute renders nothing until isAuthenticated flips true.
    if (isOuterscoreContext()) {
      return;
    }
    const timeout = setTimeout(() => {
      if (isAuthenticated) {
        return;
      }

      navigate(buildLoginRedirectUrl(location.pathname, location.search, location.hash), {
        replace: true,
      });
    }, 300);

    return () => {
      clearTimeout(timeout);
    };
  }, [isAuthenticated, navigate, location]);

  return {
    user,
    roles,
    isAuthenticated,
  };
}
