import { QueryClient } from '@tanstack/react-query';
import { ContentTypes } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { createCanvasStreamBridge } from '../canvasStream';

const PAGE_KEY = 'outerscore:page';
const MODE_KEY = 'outerscore:canvas-mode';

interface ComplianceResultMessage {
  type: string;
  findings: unknown[];
}

const isComplianceResult = (m: unknown): m is ComplianceResultMessage =>
  !!m && typeof m === 'object' && (m as { type?: string }).type === 'outerscore:compliance-result';

const FINDING_ENVELOPE =
  '<compliance>{"findings":[{"text":"works well","severity":"HIGH","reason":"vague acceptance criteria"}]}</compliance>';

const assistantReply = (text: string): TMessage =>
  ({
    messageId: 'a1',
    isCreatedByUser: false,
    text,
    // Agents stream text into content parts (assistants-style `{ value }`).
    content: [{ type: ContentTypes.TEXT, text: { value: text } }],
  }) as unknown as TMessage;

describe('canvasStream — compliance agent finalize', () => {
  let posted: unknown[];
  let realParent: Window;

  beforeEach(() => {
    sessionStorage.clear();
    posted = [];
    realParent = window.parent;
    // Simulate being embedded in the Outerscore host iframe.
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: (msg: unknown) => posted.push(msg) },
    });
    sessionStorage.setItem(PAGE_KEY, 'sow-deliverable-description');
  });

  afterEach(() => {
    Object.defineProperty(window, 'parent', { configurable: true, value: realParent });
  });

  const runFinalize = (reply: TMessage) => {
    let store: TMessage[] = [
      { messageId: 'u1', isCreatedByUser: true, text: 'check this' } as TMessage,
      reply,
    ];
    const bridge = createCanvasStreamBridge({
      getMessages: () => store,
      setMessages: (next) => {
        store = next;
      },
      queryClient: new QueryClient(),
      getConversationId: () => 'convo-1',
    });
    bridge.forwardCanvasStream();
    bridge.finalize();
    return () => store;
  };

  it('posts findings in the default (intent) routing mode', () => {
    runFinalize(assistantReply(FINDING_ENVELOPE));
    const result = posted.find(isComplianceResult);
    expect(result?.findings).toHaveLength(1);
  });

  it('posts findings when the composer toggle is in Document mode (always routing)', () => {
    sessionStorage.setItem(MODE_KEY, 'document');
    runFinalize(assistantReply(FINDING_ENVELOPE));
    const result = posted.find(isComplianceResult);
    expect(result?.findings).toHaveLength(1);
  });

  it('posts findings when the composer toggle is in Chat mode, even with a preamble', () => {
    sessionStorage.setItem(MODE_KEY, 'chat');
    runFinalize(assistantReply(`Here are the findings:\n${FINDING_ENVELOPE}`));
    const result = posted.find(isComplianceResult);
    expect(result?.findings).toHaveLength(1);
  });

  it('reads the envelope from content parts when message.text is empty', () => {
    const reply = assistantReply('');
    reply.content = [
      { type: ContentTypes.TEXT, text: { value: FINDING_ENVELOPE } },
    ] as TMessage['content'];
    runFinalize(reply);
    const result = posted.find(isComplianceResult);
    expect(result?.findings).toHaveLength(1);
  });

  it('strips the raw <compliance> JSON from the chat bubble after an audit', () => {
    const getStore = runFinalize(assistantReply(FINDING_ENVELOPE));
    const bubble = getStore()[1].text ?? '';
    expect(bubble).not.toContain('<compliance>');
  });

  it('posts an empty findings result for an all-clear audit', () => {
    runFinalize(assistantReply('<compliance>{"findings":[]}</compliance>'));
    const result = posted.find(isComplianceResult);
    expect(result).toBeDefined();
    expect(result?.findings).toHaveLength(0);
  });
});
