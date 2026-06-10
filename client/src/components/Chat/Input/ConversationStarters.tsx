import { useMemo, useCallback } from 'react';
import { EModelEndpoint, Constants } from 'librechat-data-provider';
import { useChatContext, useAgentsMapContext, useAssistantsMapContext } from '~/Providers';
import { useGetAssistantDocsQuery, useGetEndpointsQuery } from '~/data-provider';
import { isOuterscoreContext } from '~/hooks/useOuterscoreAutoLogin';
import { useSubmitMessage, useLocalize } from '~/hooks';
import { OS_EMBEDDED_STARTERS } from '~/utils/starters';
import { getIconEndpoint, getEntity } from '~/utils';

interface StarterChip {
  label: string;
  prompt: string;
}

const ConversationStarters = () => {
  const { conversation } = useChatContext();
  const agentsMap = useAgentsMapContext();
  const assistantMap = useAssistantsMapContext();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const localize = useLocalize();

  const endpointType = useMemo(() => {
    let ep = conversation?.endpoint ?? '';
    if (ep === EModelEndpoint.azureOpenAI) {
      ep = EModelEndpoint.openAI;
    }
    return getIconEndpoint({
      endpointsConfig,
      iconURL: conversation?.iconURL,
      endpoint: ep,
    });
  }, [conversation?.endpoint, conversation?.iconURL, endpointsConfig]);

  const { data: documentsMap = new Map() } = useGetAssistantDocsQuery(endpointType, {
    select: (data) => new Map(data.map((dbA) => [dbA.assistant_id, dbA])),
  });

  const { entity, isAgent } = getEntity({
    endpoint: endpointType,
    agentsMap,
    assistantMap,
    agent_id: conversation?.agent_id,
    assistant_id: conversation?.assistant_id,
  });

  const conversation_starters = useMemo(() => {
    if (entity?.conversation_starters?.length) {
      return entity.conversation_starters;
    }

    if (isAgent) {
      return [];
    }

    return documentsMap.get(entity?.id ?? '')?.conversation_starters ?? [];
  }, [documentsMap, isAgent, entity]);

  const isEmbeddedFallback = conversation_starters.length === 0 && isOuterscoreContext();

  const starters = useMemo<StarterChip[]>(() => {
    if (isEmbeddedFallback) {
      return OS_EMBEDDED_STARTERS.map(({ labelKey, prompt }) => ({
        label: localize(labelKey),
        prompt,
      }));
    }
    return conversation_starters
      .slice(0, Constants.MAX_CONVO_STARTERS)
      .map((text) => ({ label: text, prompt: text }));
  }, [isEmbeddedFallback, conversation_starters, localize]);

  const { submitMessage } = useSubmitMessage();
  const sendConversationStarter = useCallback(
    (text: string) => submitMessage({ text }),
    [submitMessage],
  );

  if (!starters.length) {
    return null;
  }

  return (
    <div className="mt-8 flex flex-wrap justify-center gap-3 px-4">
      {starters.map(({ label, prompt }, index) => (
        <button
          key={index}
          onClick={() => sendConversationStarter(prompt)}
          className={
            isEmbeddedFallback
              ? 'os-starter-chip flex cursor-pointer items-center fade-in'
              : 'relative flex w-40 cursor-pointer flex-col gap-2 rounded-2xl border border-border-medium px-3 pb-4 pt-3 text-start align-top text-[15px] shadow-[0_0_2px_0_rgba(0,0,0,0.05),0_4px_6px_0_rgba(0,0,0,0.02)] transition-colors duration-300 ease-in-out fade-in hover:bg-surface-tertiary'
          }
        >
          <p
            className={
              isEmbeddedFallback
                ? 'whitespace-nowrap'
                : 'break-word line-clamp-3 overflow-hidden text-balance break-all text-text-secondary'
            }
          >
            {label}
          </p>
        </button>
      ))}
    </div>
  );
};

export default ConversationStarters;
