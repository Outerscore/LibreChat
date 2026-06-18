import { memo, useEffect } from 'react';
import { useSetRecoilState } from 'recoil';
import { isOuterscoreContext } from '~/hooks/useOuterscoreAutoLogin';
import { useActivePanel, DEFAULT_PANEL } from '~/Providers';
import store from '~/store';

const HISTORY_EVENT = 'outerscore:open-history';

/**
 * While embedded in Outerscore, the host panel header has a "Chat history" button
 * that posts `outerscore:open-history`; `main.jsx` re-dispatches it as a window
 * CustomEvent. This bridge reproduces the manual "open sidebar → chat history"
 * action: it expands the unified sidebar and selects the conversations panel.
 *
 * Rendered inside `ActivePanelProvider` (in {@link UnifiedSidebar}) because the
 * active panel is context-local; the sidebar expansion lives on the global
 * `store.sidebarExpanded` recoil atom. Renders nothing.
 */
function OuterscoreHistoryBridge() {
  const setExpanded = useSetRecoilState(store.sidebarExpanded);
  const { setActive } = useActivePanel();

  useEffect(() => {
    if (!isOuterscoreContext()) {
      return;
    }
    const handler = () => {
      setActive(DEFAULT_PANEL);
      setExpanded(true);
    };
    window.addEventListener(HISTORY_EVENT, handler);
    return () => window.removeEventListener(HISTORY_EVENT, handler);
  }, [setActive, setExpanded]);

  return null;
}

export default memo(OuterscoreHistoryBridge);
