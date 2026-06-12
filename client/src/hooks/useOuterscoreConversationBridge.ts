import { useEffect, useRef } from 'react';
import { Constants } from 'librechat-data-provider';
import { isOuterscoreContext } from '~/hooks/useOuterscoreAutoLogin';
import { postToParent } from '~/utils/canvas';

/**
 * Posts the active conversation id to the Outerscore host so a docked AI panel
 * can deep-link the same conversation when reopened. Watches the route param —
 * the single source of truth covering new-convo (`new` → id), in-iframe
 * switching, deep-links, and abort-reset.
 *
 * Posting `null` for `/c/new` is intentional: it clears stale host state on an
 * in-iframe "New chat" and on the deleted-conversation fallback.
 * @param conversationId - The current conversation id from the route param.
 */
export default function useOuterscoreConversationBridge(conversationId: string) {
  const lastPostedRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isOuterscoreContext()) {
      return;
    }

    const id =
      conversationId && conversationId !== Constants.NEW_CONVO ? conversationId : null;

    if (lastPostedRef.current === id) {
      return;
    }
    lastPostedRef.current = id;

    postToParent({ type: 'outerscore:conversation', conversationId: id });
  }, [conversationId]);
}
