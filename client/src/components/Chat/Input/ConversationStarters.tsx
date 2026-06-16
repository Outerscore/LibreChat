import { useMemo, useCallback } from 'react';
import { EModelEndpoint, Constants } from 'librechat-data-provider';
import {
  useGetAssistantDocsQuery,
  useGetEndpointsQuery,
  useGetStartupConfig,
} from '~/data-provider';
import { useChatContext, useAgentsMapContext, useAssistantsMapContext } from '~/Providers';
import { isOuterscoreContext } from '~/hooks/useOuterscoreAutoLogin';
import { getIconEndpoint, getEntity, getModelSpec } from '~/utils';
import { OS_EMBEDDED_STARTERS } from '~/utils/starters';
import { useSubmitMessage, useLocalize } from '~/hooks';

interface StarterChip {
  label: string;
  prompt: string;
}

const ConversationStarters = () => {
  const { conversation } = useChatContext();
  const agentsMap = useAgentsMapContext();
  const assistantMap = useAssistantsMapContext();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const { data: startupConfig } = useGetStartupConfig();
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

  const modelSpec = useMemo(
    () => getModelSpec({ specName: conversation?.spec, startupConfig }),
    [conversation?.spec, startupConfig],
  );

  const conversation_starters = useMemo(() => {
    if (entity?.conversation_starters?.length) {
      return entity.conversation_starters;
    }

    if (modelSpec?.conversation_starters?.length) {
      return modelSpec.conversation_starters;
    }

    if (isAgent) {
      return [];
    }

    return documentsMap.get(entity?.id ?? '')?.conversation_starters ?? [];
  }, [documentsMap, isAgent, entity, modelSpec]);

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
    <div
      className={
        isEmbeddedFallback
          ? 'mb-8 flex flex-wrap justify-center gap-3 px-4'
          : 'mb-8 mt-2 flex w-full flex-wrap items-stretch justify-center gap-2 px-4'
      }
    >
      {starters.map(({ label, prompt }, index) => (
        <button
          key={index}
          onClick={() => sendConversationStarter(prompt)}
          style={
            isEmbeddedFallback
              ? undefined
              : { animationDelay: `${index * 75}ms`, animationFillMode: 'backwards' }
          }
          className={
            isEmbeddedFallback
              ? 'os-starter-chip flex cursor-pointer items-center fade-in'
              : 'flex max-w-[16rem] cursor-pointer items-center justify-center rounded-2xl border border-border-medium bg-surface-secondary px-4 py-2.5 text-center text-sm text-text-secondary shadow-sm transition-colors duration-200 fade-in hover:border-border-heavy hover:bg-surface-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary'
          }
        >
          {isEmbeddedFallback ? (
            <p className="whitespace-nowrap">{label}</p>
          ) : (
            <span className="line-clamp-2 text-balance break-words">{label}</span>
          )}
        </button>
      ))}
    </div>
  );
};

export default ConversationStarters;
