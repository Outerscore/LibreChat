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
 * Compliance envelope spec — appended to every canvas-mode reply. Findings may
 * include an optional `suggestion` field; the host renders an "Apply fix"
 * button only when one is present, so Claude is instructed to add it only
 * when a single document-ready rewrite is the right fix.
 */
const COMPLIANCE_CLAUSE = [
  '',
  'After the document, append a single compliance envelope on a new line:',
  '<compliance>{"findings":[{"text":"<verbatim span from the document>","severity":"HIGH|MODERATE|LOW","reason":"<short explanation>","suggestion":"<optional replacement — omit when the right fix is to delete or rewrite from scratch>"}]}</compliance>',
  'Keep each suggestion under 600 characters and write it so it can replace the flagged span in place. If there is nothing to flag, append <compliance>{"findings":[]}</compliance>. The envelope is the last thing in the reply — no commentary after it.',
].join('\n');

const OUTPUT_DISCIPLINE = 'Respond in Markdown only — no preamble, no commentary, no code fences.';

type CanvasPrompt = (userText: string, document: string) => string;

const PROJECT_BRIEF_PROMPT: CanvasPrompt = (userText, document) => {
  const trimmed = document.trim();
  const intro = trimmed
    ? [
        'You are drafting or refining a SOW (Statement of Work) Project Brief for a Buyer on the Outerscore procurement platform. The current brief is:',
        '---',
        trimmed,
        '---',
        '',
        'Apply the instruction below and respond with the complete updated brief.',
      ]
    : [
        'You are drafting a SOW (Statement of Work) Project Brief for a Buyer on the Outerscore procurement platform. The brief is currently empty.',
        'Produce a complete first draft from the instruction below.',
      ];
  return [
    ...intro,
    '',
    'Use these top-level sections in order: ## Objectives, ## Scope, ## Success criteria, ## Out of scope. Each section is one short paragraph or a tight bullet list — no filler. Keep total length under ~400 words.',
    OUTPUT_DISCIPLINE,
    '',
    'Compliance rules to check the resulting brief against:',
    '- discriminatory or biased wording (gender, age, nationality, protected characteristics)',
    '- vendor-locked or branded language where a neutral alternative exists',
    '- GDPR / data-handling obligations missing when personal data is in scope',
    '- ambiguous deadlines, vague scope statements, or unmeasurable success criteria',
    COMPLIANCE_CLAUSE,
    '',
    `Instruction: ${userText}`,
  ].join('\n');
};

const DELIVERABLE_DESC_PROMPT: CanvasPrompt = (userText, document) => {
  const trimmed = document.trim();
  const intro = trimmed
    ? [
        'You are drafting or refining the description of ONE deliverable inside a SOW Statement of Work. The current description is:',
        '---',
        trimmed,
        '---',
        '',
        'Apply the instruction below and respond with the complete updated description.',
      ]
    : [
        'You are drafting the description of ONE deliverable inside a SOW Statement of Work. The description is currently empty.',
        'Produce a complete first draft from the instruction below.',
      ];
  return [
    ...intro,
    '',
    'Use these top-level sections in order: ## What, ## Acceptance criteria, ## Dependencies, ## Estimated effort. *Acceptance criteria* must be a numbered list of objectively testable statements (no "works well", no "as needed"). *Estimated effort* should give a number plus unit (hours / days / weeks) or "TBD with a justification". Keep total length under ~250 words.',
    OUTPUT_DISCIPLINE,
    '',
    'Compliance rules to check the resulting description against:',
    '- vague acceptance criteria ("works well", "as needed", "to satisfaction")',
    '- "TBD" / "TBC" placeholders left unresolved',
    '- missing units on durations or quantities',
    '- unrealistic timelines given the listed scope',
    '- discriminatory or biased wording',
    COMPLIANCE_CLAUSE,
    '',
    `Instruction: ${userText}`,
  ].join('\n');
};

const GENERIC_CANVAS_PROMPT: CanvasPrompt = (userText, document) => {
  const trimmed = document.trim();
  if (!trimmed) {
    return [
      'You are editing a document on a canvas. The document is currently empty.',
      'Respond with the complete document content in Markdown only — no preamble, no commentary, no code fences.',
      COMPLIANCE_CLAUSE,
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
    COMPLIANCE_CLAUSE,
    '',
    `Instruction: ${userText}`,
  ].join('\n');
};

const PROMPT_BY_PAGE: Record<string, CanvasPrompt> = {
  'sow-project-brief': PROJECT_BRIEF_PROMPT,
  'sow-deliverable-description': DELIVERABLE_DESC_PROMPT,
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
  const prompt = PROMPT_BY_PAGE[page] ?? GENERIC_CANVAS_PROMPT;
  return prompt(userText, canvas);
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
