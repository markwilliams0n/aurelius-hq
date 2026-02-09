import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TelegramUpdate, TelegramMessage } from '../client';

// Mock the telegram client
vi.mock('../client', () => ({
  sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
  editMessage: vi.fn().mockResolvedValue(undefined),
  sendTypingAction: vi.fn().mockResolvedValue(undefined),
  splitMessage: vi.fn((text: string) => [text]),
  answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  setOwnerChatId: vi.fn(),
  getOwnerChatId: vi.fn().mockReturnValue(null),
}));

// Mock the AI client
vi.mock('@/lib/ai/client', async () => {
  return {
    chatStreamWithTools: vi.fn().mockImplementation(async function* () {
      yield { type: 'text', content: 'Hello! I am Aurelius, your AI assistant.' };
    }),
    DEFAULT_MODEL: 'test-model',
  };
});

// Mock the AI context builder
vi.mock('@/lib/ai/context', () => ({
  buildAgentContext: vi.fn().mockResolvedValue({
    systemPrompt: 'test system prompt',
    tools: [],
  }),
}));

// Mock the prompts
vi.mock('@/lib/ai/prompts', () => ({
  buildChatPrompt: vi.fn().mockReturnValue('System prompt'),
}));

// Mock memory search
vi.mock('@/lib/memory/search', () => ({
  buildMemoryContext: vi.fn().mockResolvedValue(null),
}));

// Mock memory extraction
vi.mock('@/lib/memory/extraction', () => ({
  extractAndSaveMemories: vi.fn().mockResolvedValue(undefined),
}));

// Mock config
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockResolvedValue(null),
}));

// Mock database
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  conversations: {},
  inboxItems: {},
  configKeyEnum: { enumValues: [] },
  configTable: {},
  activityLog: {},
  memoryEvents: {},
  actionCards: {},
  suggestedTasks: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  desc: vi.fn(),
  or: vi.fn(),
  inArray: vi.fn(),
  sql: vi.fn(),
}));

// Mock action cards
vi.mock('@/lib/action-cards/db', () => ({
  createCard: vi.fn().mockResolvedValue({ id: 'card-1' }),
  generateCardId: vi.fn().mockReturnValue('card-1'),
  getCard: vi.fn().mockResolvedValue(null),
  getPendingCards: vi.fn().mockResolvedValue([]),
  getActionableCodingSessions: vi.fn().mockResolvedValue([]),
  updateCard: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/action-cards/registry', () => ({
  dispatchCardAction: vi.fn().mockResolvedValue({ status: 'confirmed' }),
}));

// Mock all action card handlers
vi.mock('@/lib/action-cards/handlers/code', () => ({
  getActiveSessions: vi.fn().mockReturnValue(new Map()),
  telegramToSession: new Map(),
  getSessionKeyboard: vi.fn().mockReturnValue({ inline_keyboard: [] }),
  formatSessionTelegram: vi.fn().mockReturnValue('Session info'),
  finalizeZombieSession: vi.fn().mockResolvedValue('error'),
}));

vi.mock('@/lib/action-cards/handlers/slack', () => ({}));
vi.mock('@/lib/action-cards/handlers/vault', () => ({}));
vi.mock('@/lib/action-cards/handlers/config', () => ({}));
vi.mock('@/lib/action-cards/handlers/gmail', () => ({}));
vi.mock('@/lib/action-cards/handlers/linear', () => ({}));

// Mock code worktree
vi.mock('@/lib/capabilities/code/worktree', () => ({
  worktreeExists: vi.fn().mockReturnValue(false),
}));

import { handleTelegramUpdate } from '../handler';
import { sendMessage, sendTypingAction, splitMessage } from '../client';
import { chatStreamWithTools } from '@/lib/ai/client';
import { buildAgentContext } from '@/lib/ai/context';

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
        expect.stringContaining('Aurelius Help')
      );
    });
  });

  describe('regular chat messages', () => {
    it('sends typing indicator', async () => {
      const update = createUpdate(createMessage('Hello'));
      await handleTelegramUpdate(update);

      expect(sendTypingAction).toHaveBeenCalledWith(12345);
    });

    it('calls AI with tools', async () => {
      const update = createUpdate(createMessage('Hello'));
      await handleTelegramUpdate(update);

      expect(chatStreamWithTools).toHaveBeenCalled();
    });

    it('builds agent context', async () => {
      const update = createUpdate(createMessage('Hello'));
      await handleTelegramUpdate(update);

      expect(buildAgentContext).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'Hello',
        })
      );
    });

    it('sends AI response back to user', async () => {
      vi.mocked(splitMessage).mockReturnValueOnce(['Hello! I am Aurelius, your AI assistant.']);

      const update = createUpdate(createMessage('Hello'));
      await handleTelegramUpdate(update);

      expect(sendMessage).toHaveBeenCalledWith(12345, 'Hello! I am Aurelius, your AI assistant.');
    });

    it('handles AI errors gracefully', async () => {
      vi.mocked(chatStreamWithTools).mockImplementationOnce(async function* () {
        throw new Error('AI error');
      });

      const update = createUpdate(createMessage('Hello'));
      await handleTelegramUpdate(update);

      expect(sendMessage).toHaveBeenCalledWith(
        12345,
        expect.stringContaining('error')
      );
    });

    it('splits long responses', async () => {
      vi.mocked(splitMessage).mockReturnValueOnce(['Part 1', 'Part 2']);

      const update = createUpdate(createMessage('Hello'));
      await handleTelegramUpdate(update);

      expect(sendMessage).toHaveBeenCalledWith(12345, 'Part 1');
      expect(sendMessage).toHaveBeenCalledWith(12345, 'Part 2');
    });
  });

  describe('unknown commands', () => {
    it('treats unknown commands as regular messages', async () => {
      vi.mocked(splitMessage).mockReturnValueOnce(['Response']);

      const update = createUpdate(createMessage('/unknown'));
      await handleTelegramUpdate(update);

      // Should process as regular message (call AI)
      expect(chatStreamWithTools).toHaveBeenCalled();
    });
  });
});
