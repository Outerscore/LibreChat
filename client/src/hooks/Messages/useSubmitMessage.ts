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

/**
 * Compliance envelope spec — appended *inside* a document reply only. Findings
 * may include an optional `suggestion`; the host renders an "Apply fix" button
 * only when one is present, so Claude is told to add it only when a single
 * document-ready rewrite is the right fix.
 */
const complianceClause = (rules: string[]): string =>
  [
    'Immediately after </document>, append a single compliance envelope and nothing else:',
    '<compliance>{"findings":[{"text":"<verbatim span from the document>","severity":"HIGH|MODERATE|LOW","reason":"<short explanation>","suggestion":"<optional replacement — omit when the right fix is to delete or rewrite from scratch>"}]}</compliance>',
    'Keep each suggestion under 600 characters and write it so it can replace the flagged span in place. If there is nothing to flag, append <compliance>{"findings":[]}</compliance>.',
    'Check the document against these rules:',
    ...rules.map((r) => `- ${r}`),
  ].join('\n');

interface CanvasSpec {
  /** Human name of the artifact, e.g. "SOW Project Brief". */
  artifact: string;
  /** One sentence describing the required section structure. */
  structure: string;
  /** Compliance rules relevant to this artifact. */
  rules: string[];
}

/**
 * Intent-aware canvas prompt. The model decides, per turn, whether the user is
 * asking for document work or just chatting:
 *  - document work  → reply is ONLY `<document>…</document>` + `<compliance>…`,
 *    which the host streams into the editor canvas;
 *  - anything else  → a normal chat reply with no tags, which stays in the chat.
 */
const buildSpecPrompt = (spec: CanvasSpec, userText: string, document: string): string => {
  const trimmed = document.trim();
  return [
    `You are an assistant embedded next to a ${spec.artifact} editor on the Outerscore procurement platform.`,
    trimmed
      ? `The current ${spec.artifact} content is:\n---\n${trimmed}\n---`
      : `The ${spec.artifact} is currently empty.`,
    '',
    "Decide how to respond based on the user's message:",
    '',
    `1. If the user asks you to WRITE, DRAFT, REWRITE, UPDATE, TRANSLATE, SHORTEN, EXPAND or otherwise change the ${spec.artifact}, reply with the COMPLETE updated document and nothing before it. Begin your reply with the <document> tag:`,
    '<document>',
    '...the full document in Markdown — no preamble, no commentary, no code fences...',
    '</document>',
    spec.structure,
    complianceClause(spec.rules),
    'The <document> block followed by the <compliance> envelope is the ENTIRE reply — output nothing else.',
    '',
    '2. Otherwise (a question, advice, brainstorming, or general chat), reply normally as a helpful assistant in plain Markdown. Do NOT use <document> or <compliance> tags. You may refer to the document content above.',
    '',
    `User: ${userText}`,
  ].join('\n');
};

const PROJECT_BRIEF_SPEC: CanvasSpec = {
  artifact: 'SOW Project Brief',
  structure:
    'Use these top-level sections in order: ## Objectives, ## Scope, ## Success criteria, ## Out of scope. Keep it under ~400 words.',
  rules: [
    'discriminatory or biased wording (gender, age, nationality, protected characteristics)',
    'vendor-locked or branded language where a neutral alternative exists',
    'GDPR / data-handling obligations missing when personal data is in scope',
    'ambiguous deadlines, vague scope statements, or unmeasurable success criteria',
  ],
};

const DELIVERABLE_DESC_SPEC: CanvasSpec = {
  artifact: 'SOW deliverable description',
  structure:
    'Use these top-level sections in order: ## What, ## Acceptance criteria, ## Dependencies, ## Estimated effort. Acceptance criteria must be a numbered list of objectively testable statements. Keep it under ~250 words.',
  rules: [
    'vague acceptance criteria ("works well", "as needed", "to satisfaction")',
    '"TBD" / "TBC" placeholders left unresolved',
    'missing units on durations or quantities',
    'unrealistic timelines given the listed scope',
    'discriminatory or biased wording',
  ],
};

const GENERIC_SPEC: CanvasSpec = {
  artifact: 'document',
  structure: 'Keep the structure that best fits the document.',
  rules: ['discriminatory or biased wording', 'unverifiable or non-compliant claims'],
};

const SPEC_BY_PAGE: Record<string, CanvasSpec> = {
  'sow-project-brief': PROJECT_BRIEF_SPEC,
  'sow-deliverable-description': DELIVERABLE_DESC_SPEC,
};

const buildCanvasPrompt = (userText: string): string => {
  let page = '';
  let canvas = '';
  try {
    page = sessionStorage.getItem(CANVAS_PAGE_KEY) ?? '';
    canvas = sessionStorage.getItem(CANVAS_CONTEXT_KEY) ?? '';
  } catch {
    return userText;
  }
  if (!CANVAS_PAGES.has(page)) {
    return userText;
  }
  const spec = SPEC_BY_PAGE[page] ?? GENERIC_SPEC;
  return buildSpecPrompt(spec, userText, canvas);
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
