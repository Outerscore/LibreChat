import { useCallback } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { replaceSpecialVars } from 'librechat-data-provider';
import { useChatContext, useChatFormContext, useAddedChatContext } from '~/Providers';
import { useAuthContext } from '~/hooks/AuthContext';
import { mainTextareaId } from '~/common';
import store from '~/store';

const CANVAS_CONTEXT_KEY = 'outerscore:canvas-content';
const CANVAS_PAGE_KEY = 'outerscore:page';
const CANVAS_PAGES = new Set([
  'canvas2',
  'sow-project-brief',
  'sow-deliverable-description',
]);

const buildCanvasPrompt = (userText: string): string => {
  let canvas = '';
  let isCanvas = false;
  try {
    const page = sessionStorage.getItem(CANVAS_PAGE_KEY) ?? '';
    isCanvas = CANVAS_PAGES.has(page);
    canvas = sessionStorage.getItem(CANVAS_CONTEXT_KEY) ?? '';
  } catch {
    return userText;
  }
  if (!isCanvas) {
    return userText;
  }
  const trimmed = canvas.trim();
  if (!trimmed) {
    return [
      'You are editing a document on a canvas. The document is currently empty.',
      'Respond with the complete document content in Markdown only — no preamble, no commentary, no code fences.',
      '',
      `Instruction: ${userText}`,
    ].join('\n');
  }
  return [
    'You are editing a document on a canvas. The current document content is:',
    '---',
    trimmed,
    '---',
    '',
    'Apply the instruction below and respond with the complete updated document in Markdown only — no preamble, no commentary, no code fences.',
    '',
    `Instruction: ${userText}`,
  ].join('\n');
};

export default function useSubmitMessage() {
  const { user } = useAuthContext();
  const methods = useChatFormContext();
  const { conversation: addedConvo } = useAddedChatContext();
  const { ask, index, getMessages, setMessages } = useChatContext();
  const latestMessage = useRecoilValue(store.latestMessageFamily(index));

  const autoSendPrompts = useRecoilValue(store.autoSendPrompts);
  const setActivePrompt = useSetRecoilState(store.activePromptByIndex(index));

  const submitMessage = useCallback(
    (data?: { text: string }) => {
      if (!data) {
        return console.warn('No data provided to submitMessage');
      }
      const rootMessages = getMessages();
      const isLatestInRootMessages = rootMessages?.some(
        (message) => message.messageId === latestMessage?.messageId,
      );
      if (!isLatestInRootMessages && latestMessage) {
        setMessages([...(rootMessages || []), latestMessage]);
      }

      const augmentedText = buildCanvasPrompt(data.text);

      ask(
        {
          text: augmentedText,
        },
        {
          addedConvo: addedConvo ?? undefined,
        },
      );
      methods.reset();
    },
    [ask, methods, addedConvo, setMessages, getMessages, latestMessage],
  );

  const submitPrompt = useCallback(
    (text: string) => {
      const parsedText = replaceSpecialVars({ text, user });
      if (autoSendPrompts) {
        submitMessage({ text: parsedText });
        return;
      }

      const textarea = document.getElementById(mainTextareaId) as HTMLTextAreaElement | null;
      const currentText = textarea?.value ?? methods.getValues('text');
      const newText = currentText.trim().length > 1 ? `\n${parsedText}` : parsedText;
      setActivePrompt(newText);
    },
    [autoSendPrompts, submitMessage, setActivePrompt, methods, user],
  );

  return { submitMessage, submitPrompt };
}
