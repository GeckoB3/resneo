/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/dashboard/calendar' }));

import { AssistantProvider } from './AssistantProvider';
import { AssistantSheet } from './AssistantSheet';
import { AssistantLauncher } from './AssistantLauncher';
import { ASSISTANT_HANDOFF_KEY, ASSISTANT_CONVERSATION_KEY, resetHandoffCache } from './handoff';

/** A Response whose body streams the given SSE frames, one chunk each. */
function sseResponse(frames: string[], init: { ok?: boolean; status?: number } = {}) {
  const encoder = new TextEncoder();
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const f of frames) controller.enqueue(encoder.encode(f));
        controller.close();
      },
    }),
    json: async () => ({}),
  } as unknown as Response;
}

function answerFrames(text: string, opts: { citations?: string[]; answered?: boolean; messageId?: string | null } = {}) {
  const tokens = text.match(/[sS]{1,12}/g) ?? [];
  return [
    `event: meta\ndata: ${JSON.stringify({ conversationId: 'conv-1', userMessageId: 'msg-1', model: 'test-model' })}\n\n`,
    ...tokens.map((t) => `event: token\ndata: ${JSON.stringify({ t })}\n\n`),
    `event: done\ndata: ${JSON.stringify({
      assistantMessageId: opts.messageId === undefined ? 'msg-2' : opts.messageId,
      text,
      citations: opts.citations ?? [],
      answered: opts.answered ?? true,
    })}\n\n`,
  ];
}

const fetchMock = vi.fn();

function renderAssistant() {
  return render(
    <AssistantProvider enabled>
      <AssistantLauncher />
      <AssistantSheet />
    </AssistantProvider>,
  );
}

async function openAndAsk(user: ReturnType<typeof userEvent.setup>, question: string) {
  await user.click(screen.getByTestId('assistant-launcher'));
  const box = await screen.findByLabelText('Ask how to do something in ResNeo');
  await user.type(box, question);
  await user.click(screen.getByRole('button', { name: 'Send' }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  push.mockReset();
  window.sessionStorage.clear();
  resetHandoffCache();
  // The hook reports the real browser path, not the router's, so set one.
  (window as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM?.setURL?.('https://resneo.test/dashboard/calendar');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Docs/help-assistant-plan.md, 3.3: the drawer, end to end against a mocked stream. */
describe('Ask ResNeo drawer', () => {
  it('opens from the launcher, streams an answer, and renders its help link', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      sseResponse(
        answerFrames('1. Open **Settings** and press **Payments**.\n\nRead more: [Connect Stripe](/help/getting-started/stripe-payments)', {
          citations: ['getting-started/stripe-payments'],
        }),
      ),
    );
    renderAssistant();

    expect(screen.queryByTestId('assistant-conversation')).not.toBeInTheDocument();
    await openAndAsk(user, 'How do I connect Stripe?');

    await waitFor(() => expect(screen.getByText(/Open/)).toBeInTheDocument());
    expect(screen.getByText('How do I connect Stripe?')).toBeInTheDocument();
    // Bold markup survives, and the link points at the real help page in a new tab.
    const link = await screen.findByRole('link', { name: 'Connect Stripe' });
    expect(link).toHaveAttribute('href', '/help/getting-started/stripe-payments');
    expect(link).toHaveAttribute('target', '_blank');

    // The request carried the conversation, the client and the page.
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body.messages).toEqual([{ role: 'user', content: 'How do I connect Stripe?' }]);
    expect(body.client).toBe('web');
    expect(body.page).toBe('/dashboard/calendar');
  });

  it('carries the conversation id and history into the follow-up question', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(sseResponse(answerFrames('First answer.')))
      .mockResolvedValueOnce(sseResponse(answerFrames('Second answer.')));
    renderAssistant();

    await openAndAsk(user, 'First question');
    await waitFor(() => expect(screen.getByText('First answer.')).toBeInTheDocument());

    const box = screen.getByLabelText('Ask how to do something in ResNeo');
    await user.type(box, 'Second question');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('Second answer.')).toBeInTheDocument());

    const body = JSON.parse(fetchMock.mock.calls[1]![1].body as string) as Record<string, unknown>;
    expect(body.conversationId).toBe('conv-1');
    expect(body.messages).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer.' },
      { role: 'user', content: 'Second question' },
    ]);
  });

  it('records a thumbs up against the stored message', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(sseResponse(answerFrames('Here is how.'))).mockResolvedValueOnce({ ok: true, status: 204 } as Response);
    renderAssistant();

    await openAndAsk(user, 'A question');
    await waitFor(() => expect(screen.getByText('Here is how.')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Yes, this was helpful' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/venue/assistant/feedback');
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string)).toEqual({ messageId: 'msg-2', rating: 1 });
    expect(screen.getByText('Thanks, that helps us improve the help centre.')).toBeInTheDocument();
  });

  it('hands the conversation to the Support form', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(sseResponse(answerFrames('Not much help, sorry.')));
    renderAssistant();

    await openAndAsk(user, 'Something obscure');
    await waitFor(() => expect(screen.getByText('Not much help, sorry.')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Send this to support' }));
    expect(push).toHaveBeenCalledWith('/dashboard/support');
    const stored = JSON.parse(window.sessionStorage.getItem(ASSISTANT_HANDOFF_KEY)!) as { subject: string; message: string };
    expect(stored.subject).toBe('Question from Ask ResNeo');
    expect(stored.message).toContain('Me: Something obscure');
    expect(stored.message).toContain('Ask ResNeo: Not much help, sorry.');
  });

  it('shows the daily cap notice and stops accepting questions', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ code: 'daily_cap', error: 'x' }) } as Response);
    renderAssistant();

    await openAndAsk(user, 'A question');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/reached today's limit/i));
    expect(screen.getByLabelText('Ask how to do something in ResNeo')).toBeDisabled();
  });

  it('surfaces a server error on the answer it belongs to', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        `event: meta\ndata: ${JSON.stringify({ conversationId: 'conv-1', userMessageId: 'msg-1' })}\n\n`,
        `event: error\ndata: ${JSON.stringify({ message: 'Something went wrong while answering.' })}\n\n`,
      ]),
    );
    renderAssistant();

    await openAndAsk(user, 'A question');
    await waitFor(() => expect(screen.getByText('Something went wrong while answering.')).toBeInTheDocument());
  });

  it('remembers the conversation in sessionStorage and forgets it on Start again', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(sseResponse(answerFrames('Remembered answer.')));
    renderAssistant();

    await openAndAsk(user, 'A question');
    await waitFor(() => expect(screen.getByText('Remembered answer.')).toBeInTheDocument());
    await waitFor(() => expect(window.sessionStorage.getItem(ASSISTANT_CONVERSATION_KEY)).toContain('Remembered answer.'));

    await user.click(screen.getByRole('button', { name: 'Start again' }));
    await waitFor(() => expect(screen.queryByText('Remembered answer.')).not.toBeInTheDocument());
    expect(window.sessionStorage.getItem(ASSISTANT_CONVERSATION_KEY)).toBeNull();
  });

  it('renders nothing at all while the assistant is switched off', () => {
    render(
      <AssistantProvider enabled={false}>
        <AssistantLauncher />
        <AssistantSheet />
      </AssistantProvider>,
    );
    expect(screen.queryByTestId('assistant-launcher')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
