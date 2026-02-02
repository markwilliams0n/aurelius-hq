import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTelegramUpdate } from '../handler';
import type { TelegramUpdate, TelegramMessage } from '../client';

// Mock the telegram client
vi.mock('../client', () => ({
  sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
  sendTypingAction: vi.fn().mockResolvedValue(undefined),
  splitMessage: vi.fn((text: string) => [text]),
}));

// Mock the AI client
vi.mock('@/lib/ai/client', () => ({
  chat: vi.fn().mockResolvedValue('Hello! I am Aurelius, your AI assistant.'),
}));

// Mock the memory facts
vi.mock('@/lib/memory/facts', () => ({
  getRecentFacts: vi.fn().mockResolvedValue([]),
}));

import { sendMessage, sendTypingAction, splitMessage } from '../client';
import { chat } from '@/lib/ai/client';
import { getRecentFacts } from '@/lib/memory/facts';

describe('Telegram Handler', () => {
  const createMessage = (text: string, chatId = 12345): TelegramMessage => ({
    message_id: 1,
    chat: {
      id: chatId,
      type: 'private',
      first_name: 'Test',
    },
    date: Math.floor(Date.now() / 1000),
    text,
    from: {
      id: 67890,
      is_bot: false,
      first_name: 'Test',
      username: 'testuser',
    },
  });

  const createUpdate = (message: TelegramMessage): TelegramUpdate => ({
    update_id: 1,
    message,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleTelegramUpdate', () => {
    it('ignores updates without messages', async () => {
      await handleTelegramUpdate({ update_id: 1 });
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('ignores messages without text', async () => {
      const update = createUpdate({
        ...createMessage(''),
        text: undefined,
      });
      await handleTelegramUpdate(update);
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('ignores empty text messages', async () => {
      const update = createUpdate(createMessage('   '));
      await handleTelegramUpdate(update);
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('/start command', () => {
    it('responds with welcome message', async () => {
      const update = createUpdate(createMessage('/start'));
      await handleTelegramUpdate(update);

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(
        12345,
        expect.stringContaining("I'm Aurelius")
      );
    });

    it('includes user first name in welcome', async () => {
      const message = createMessage('/start');
      message.from!.first_name = 'Alice';
      const update = createUpdate(message);

      await handleTelegramUpdate(update);

      expect(sendMessage).toHaveBeenCalledWith(
        12345,
        expect.stringContaining('Hello Alice')
      );
    });
  });

  describe('/clear command', () => {
    it('responds with confirmation', async () => {
      const update = createUpdate(createMessage('/clear'));
      await handleTelegramUpdate(update);

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(
        12345,
        expect.stringContaining('cleared')
      );
    });
  });

  describe('/help command', () => {
    it('responds with help message', async () => {
      const update = createUpdate(createMessage('/help'));
      await handleTelegramUpdate(update);

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(
        12345,
        expect.stringContaining('Aurelius Help'),
        expect.objectContaining({ parseMode: 'Markdown' })
      );
    });
  });

  describe('regular chat messages', () => {
    it('sends typing indicator', async () => {
      const update = createUpdate(createMessage('Hello'));
      await handleTelegramUpdate(update);

      expect(sendTypingAction).toHaveBeenCalledWith(12345);
    });

    it('calls AI chat function', async () => {
      const update = createUpdate(createMessage('Hello'));
      await handleTelegramUpdate(update);

      expect(chat).toHaveBeenCalled();
    });

    it('fetches memory context', async () => {
      const update = createUpdate(createMessage('Hello'));
      await handleTelegramUpdate(update);

      expect(getRecentFacts).toHaveBeenCalled();
    });

    it('sends AI response back to user', async () => {
      vi.mocked(chat).mockResolvedValueOnce('This is a test response');
      vi.mocked(splitMessage).mockReturnValueOnce(['This is a test response']);

      const update = createUpdate(createMessage('Hello'));
      await handleTelegramUpdate(update);

      expect(sendMessage).toHaveBeenCalledWith(12345, 'This is a test response');
    });

    it('handles AI errors gracefully', async () => {
      vi.mocked(chat).mockRejectedValueOnce(new Error('AI error'));

      const update = createUpdate(createMessage('Hello'));
      await handleTelegramUpdate(update);

      expect(sendMessage).toHaveBeenCalledWith(
        12345,
        expect.stringContaining('error')
      );
    });

    it('splits long responses', async () => {
      vi.mocked(chat).mockResolvedValueOnce('Long response');
      vi.mocked(splitMessage).mockReturnValueOnce(['Part 1', 'Part 2']);

      const update = createUpdate(createMessage('Hello'));
      await handleTelegramUpdate(update);

      expect(sendMessage).toHaveBeenCalledWith(12345, 'Part 1');
      expect(sendMessage).toHaveBeenCalledWith(12345, 'Part 2');
    });
  });

  describe('conversation history', () => {
    it('maintains conversation context across messages', async () => {
      vi.mocked(chat).mockResolvedValue('Response');
      vi.mocked(splitMessage).mockReturnValue(['Response']);

      // First message
      await handleTelegramUpdate(createUpdate(createMessage('First message')));

      // Second message
      await handleTelegramUpdate(createUpdate(createMessage('Second message')));

      // The second call should include history from the first message
      const secondCall = vi.mocked(chat).mock.calls[1];
      const messages = secondCall[0];

      // Should have system message + history + new message
      expect(messages.length).toBeGreaterThan(2);
    });

    it('clears history with /clear command', async () => {
      vi.mocked(chat).mockResolvedValue('Response');
      vi.mocked(splitMessage).mockReturnValue(['Response']);

      // First message
      await handleTelegramUpdate(createUpdate(createMessage('First message')));

      // Clear
      await handleTelegramUpdate(createUpdate(createMessage('/clear')));

      // New message after clear
      await handleTelegramUpdate(createUpdate(createMessage('New message')));

      // The call after clear should start fresh
      const lastCall = vi.mocked(chat).mock.calls[vi.mocked(chat).mock.calls.length - 1];
      const messages = lastCall[0];

      // Should only have system message + new message (no history)
      expect(messages.length).toBe(2); // system + user
    });

    it('keeps separate history per chat', async () => {
      vi.mocked(chat).mockResolvedValue('Response');
      vi.mocked(splitMessage).mockReturnValue(['Response']);

      // Message in chat 1
      await handleTelegramUpdate(createUpdate(createMessage('Chat 1 message', 111)));

      // Message in chat 2
      await handleTelegramUpdate(createUpdate(createMessage('Chat 2 message', 222)));

      // Each chat should have its own history
      expect(vi.mocked(chat)).toHaveBeenCalledTimes(2);
    });
  });

  describe('unknown commands', () => {
    it('treats unknown commands as regular messages', async () => {
      vi.mocked(chat).mockResolvedValue('Response');
      vi.mocked(splitMessage).mockReturnValue(['Response']);

      const update = createUpdate(createMessage('/unknown'));
      await handleTelegramUpdate(update);

      // Should process as regular message (call AI)
      expect(chat).toHaveBeenCalled();
    });
  });
});
