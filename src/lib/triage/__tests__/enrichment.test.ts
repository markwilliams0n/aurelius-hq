import { describe, it, expect, vi } from 'vitest';
import { enrichTriageItem, enrichTriageItems, type EnrichmentResult } from '../enrichment';
import type { NewInboxItem } from '@/lib/db/schema';

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).substring(7),
});

// Mock Ollama as unavailable so tests exercise the regex fallback path
vi.mock('@/lib/memory/ollama', () => ({
  isOllamaAvailable: vi.fn().mockResolvedValue(false),
  generate: vi.fn(),
}));

// Mock memory search to return empty results
vi.mock('@/lib/memory/search', () => ({
  searchMemory: vi.fn().mockReturnValue([]),
}));

describe('enrichment', () => {
  describe('enrichTriageItem', () => {
    describe('priority classification', () => {
      it('classifies urgent keywords as urgent priority', async () => {
        const urgentKeywords = ['urgent', 'critical', 'emergency', 'incident', 'outage'];

        for (const keyword of urgentKeywords) {
          const item: NewInboxItem = {
            connector: 'gmail',
            externalId: 'test-1',
            sender: 'test@example.com',
            subject: `Test ${keyword} message`,
            content: 'Some content',
            status: 'new',
            priority: 'normal',
            tags: [],
          };

          const result = await enrichTriageItem(item);
          expect(result.suggestedPriority).toBe('urgent');
        }
      });

      it('classifies high priority keywords as high', async () => {
        const highKeywords = ['important', 'deadline', 'action required', 'approval needed'];

        for (const keyword of highKeywords) {
          const item: NewInboxItem = {
            connector: 'gmail',
            externalId: 'test-1',
            sender: 'test@example.com',
            subject: `Test ${keyword} message`,
            content: 'Some content',
            status: 'new',
            priority: 'normal',
            tags: [],
          };

          const result = await enrichTriageItem(item);
          expect(result.suggestedPriority).toBe('high');
        }
      });

      it('classifies low priority keywords as low', async () => {
        const lowKeywords = ['newsletter', 'fyi', 'automated', 'digest'];

        for (const keyword of lowKeywords) {
          const item: NewInboxItem = {
            connector: 'gmail',
            externalId: 'test-1',
            sender: 'test@example.com',
            subject: `Test ${keyword} message`,
            content: 'Some content',
            status: 'new',
            priority: 'normal',
            tags: [],
          };

          const result = await enrichTriageItem(item);
          expect(result.suggestedPriority).toBe('low');
        }
      });

      it('defaults to normal priority for generic content', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'test@example.com',
          subject: 'Hello',
          content: 'How are you doing?',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        expect(result.suggestedPriority).toBe('normal');
      });

      it('is case-insensitive for keyword matching', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'test@example.com',
          subject: 'URGENT: Please respond',
          content: 'Some content',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        expect(result.suggestedPriority).toBe('urgent');
      });
    });

    describe('tag suggestion', () => {
      it('always includes connector as a tag', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'test@example.com',
          subject: 'Hello',
          content: 'Generic content',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        expect(result.suggestedTags).toContain('gmail');
      });

      it('suggests meeting tag for scheduling-related content', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'test@example.com',
          subject: 'Schedule a call',
          content: 'Can we schedule a meeting next week?',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        expect(result.suggestedTags).toContain('meeting');
      });

      it('suggests bug tag for issue-related content', async () => {
        const item: NewInboxItem = {
          connector: 'linear',
          externalId: 'test-1',
          sender: 'Project X',
          subject: '[Bug] Login page broken',
          content: 'Users cannot log in',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        expect(result.suggestedTags).toContain('bug');
      });

      it('suggests finance tag for money-related content', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'billing@company.com',
          subject: 'Invoice #12345',
          content: 'Please find attached your invoice for payment',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        expect(result.suggestedTags).toContain('finance');
      });

      it('suggests security tag for security-related content', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'security@company.com',
          subject: 'Security audit results',
          content: 'Vulnerability found in the API',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        expect(result.suggestedTags).toContain('security');
      });

      it('limits to maximum of 5 tags', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'test@example.com',
          subject: 'Meeting to review bug fix and deploy invoice payment',
          content: 'Lets schedule a call to review the security vulnerability fix for the feature release',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        expect(result.suggestedTags.length).toBeLessThanOrEqual(5);
      });
    });

    describe('entity extraction', () => {
      it('extracts sender as person entity', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'john@example.com',
          senderName: 'John Doe',
          subject: 'Hello',
          content: 'Hi there',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        const personEntity = result.linkedEntities.find(e => e.type === 'person');

        expect(personEntity).toBeDefined();
        expect(personEntity?.name).toBe('John Doe');
      });

      it('extracts company from email domain', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'john@acme.io',
          senderName: 'John Doe',
          subject: 'Hello',
          content: 'Hi there',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        const companyEntity = result.linkedEntities.find(e => e.type === 'company');

        expect(companyEntity).toBeDefined();
        expect(companyEntity?.name).toBe('Acme');
      });

      it('does not extract company from personal email domains', async () => {
        const personalDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];

        for (const domain of personalDomains) {
          const item: NewInboxItem = {
            connector: 'gmail',
            externalId: 'test-1',
            sender: `john@${domain}`,
            senderName: 'John Doe',
            subject: 'Hello',
            content: 'Hi there',
            status: 'new',
            priority: 'normal',
            tags: [],
          };

          const result = await enrichTriageItem(item);
          const companyEntity = result.linkedEntities.find(e => e.type === 'company');

          expect(companyEntity).toBeUndefined();
        }
      });

      it('extracts project entity from Linear items', async () => {
        const item: NewInboxItem = {
          connector: 'linear',
          externalId: 'test-1',
          sender: 'Mobile App v2',
          senderName: 'Jane Smith',
          subject: '[Bug] Something is broken',
          content: 'Details here',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        const projectEntity = result.linkedEntities.find(e => e.type === 'project');

        expect(projectEntity).toBeDefined();
        expect(projectEntity?.name).toBe('Mobile App v2');
      });

      it('extracts team entity from Slack channels', async () => {
        const item: NewInboxItem = {
          connector: 'slack',
          externalId: 'test-1',
          sender: '#engineering',
          senderName: 'John Doe',
          subject: 'Build notification',
          content: 'Build passed',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        const teamEntity = result.linkedEntities.find(e => e.type === 'team');

        expect(teamEntity).toBeDefined();
        expect(teamEntity?.name).toBe('engineering');
      });
    });

    describe('summary generation', () => {
      it('identifies follow-up messages', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'test@example.com',
          subject: 'Re: Project discussion',
          content: 'Thanks for the update',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        expect(result.summary).toContain('Follow-up');
      });

      it('identifies scheduling requests', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'test@example.com',
          subject: 'Let me know your availability',
          content: 'Can we schedule a meeting next week?',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        expect(result.summary).toContain('Scheduling');
      });

      it('identifies urgent matters', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'test@example.com',
          subject: 'URGENT: Server down',
          content: 'Critical issue needs immediate attention',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        expect(result.summary).toContain('Urgent');
      });

      it('identifies Linear bug reports', async () => {
        const item: NewInboxItem = {
          connector: 'linear',
          externalId: 'test-1',
          sender: 'Project',
          subject: '[Bug] Login fails',
          content: 'Users cannot log in',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        expect(result.summary).toContain('Bug');
      });

      it('identifies Linear feature requests', async () => {
        const item: NewInboxItem = {
          connector: 'linear',
          externalId: 'test-1',
          sender: 'Project',
          subject: '[Feature] Add dark mode',
          content: 'Users want dark mode',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        expect(result.summary).toContain('Feature');
      });
    });

    describe('action suggestions', () => {
      it('suggests quick reply for urgent items', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'test@example.com',
          subject: 'URGENT: Need help',
          content: 'Critical issue',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        const replyAction = result.suggestedActions.find(a => a.type === 'reply');

        expect(replyAction).toBeDefined();
      });

      it('suggests task creation for actionable items', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'test@example.com',
          subject: 'Action required: Review document',
          content: 'Please review by deadline',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        const taskAction = result.suggestedActions.find(a => a.type === 'task');

        expect(taskAction).toBeDefined();
      });

      it('suggests archive for newsletters', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'newsletter@company.com',
          subject: 'Weekly newsletter',
          content: 'This week in tech digest...',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        const archiveAction = result.suggestedActions.find(a => a.type === 'archive');

        expect(archiveAction).toBeDefined();
      });

      it('limits suggested actions to 3', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'test@example.com',
          subject: 'Meeting to discuss urgent newsletter action required',
          content: 'Please schedule a call to discuss the deadline for this update newsletter',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        expect(result.suggestedActions.length).toBeLessThanOrEqual(3);
      });
    });

    describe('memory context', () => {
      it('returns undefined when memory search returns no results', async () => {
        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'sarah.chen@acme.io',
          senderName: 'Sarah Chen',
          subject: 'Project update',
          content: 'Here is the update',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        // With mocked empty search results, contextFromMemory should be undefined
        expect(result.contextFromMemory).toBeUndefined();
      });

      it('returns memory context when search returns results', async () => {
        const { searchMemory } = await import('@/lib/memory/search');
        const mockSearchMemory = vi.mocked(searchMemory);
        mockSearchMemory.mockReturnValueOnce([
          { path: '/test', content: 'Sarah is the CTO at Acme Corp', score: 0.9, collection: 'life' },
        ]);

        const item: NewInboxItem = {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'sarah.chen@acme.io',
          senderName: 'Sarah Chen',
          subject: 'Project update',
          content: 'Here is the update',
          status: 'new',
          priority: 'normal',
          tags: [],
        };

        const result = await enrichTriageItem(item);
        expect(result.contextFromMemory).toBeDefined();
        expect(result.contextFromMemory).toContain('Sarah');
      });
    });
  });

  describe('Ollama enrichment', () => {
    it('uses Ollama when available', async () => {
      const { isOllamaAvailable, generate } = await import('@/lib/memory/ollama');
      vi.mocked(isOllamaAvailable).mockResolvedValueOnce(true);
      vi.mocked(generate).mockResolvedValueOnce(JSON.stringify({
        priority: 'high',
        tags: ['meeting', 'urgent'],
        summary: 'Important meeting request',
        actions: [{ type: 'reply', label: 'Schedule', reason: 'Meeting request' }],
      }));

      const item: NewInboxItem = {
        connector: 'gmail',
        externalId: 'test-1',
        sender: 'test@example.com',
        subject: 'Hello',
        content: 'Test',
        status: 'new',
        priority: 'normal',
        tags: [],
      };

      const result = await enrichTriageItem(item);

      expect(result.suggestedPriority).toBe('high');
      expect(result.suggestedTags).toContain('meeting');
      expect(result.summary).toBe('Important meeting request');
    });

    it('falls back to regex when Ollama fails', async () => {
      const { isOllamaAvailable, generate } = await import('@/lib/memory/ollama');
      vi.mocked(isOllamaAvailable).mockResolvedValueOnce(true);
      vi.mocked(generate).mockRejectedValueOnce(new Error('Ollama down'));

      const item: NewInboxItem = {
        connector: 'gmail',
        externalId: 'test-1',
        sender: 'test@example.com',
        subject: 'Urgent issue',
        content: 'Something urgent',
        status: 'new',
        priority: 'normal',
        tags: [],
      };

      const result = await enrichTriageItem(item);

      // Should fall back to regex which detects "urgent"
      expect(result.suggestedPriority).toBe('urgent');
    });
  });

  describe('enrichTriageItems (batch)', () => {
    it('enriches multiple items', async () => {
      const items: NewInboxItem[] = [
        {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'test1@example.com',
          subject: 'Email 1',
          content: 'Content 1',
          status: 'new',
          priority: 'normal',
          tags: [],
        },
        {
          connector: 'slack',
          externalId: 'test-2',
          sender: '#general',
          subject: 'Message 1',
          content: 'Content 2',
          status: 'new',
          priority: 'normal',
          tags: [],
        },
      ];

      const enriched = await enrichTriageItems(items);

      expect(enriched).toHaveLength(2);
      expect(enriched[0].enrichment).toBeDefined();
      expect(enriched[1].enrichment).toBeDefined();
    });

    it('preserves original item properties', async () => {
      const items: NewInboxItem[] = [
        {
          connector: 'gmail',
          externalId: 'test-1',
          sender: 'test@example.com',
          senderName: 'Test User',
          subject: 'Test Subject',
          content: 'Test Content',
          status: 'new',
          priority: 'high',
          tags: ['existing-tag'],
        },
      ];

      const enriched = await enrichTriageItems(items);

      expect(enriched[0].connector).toBe('gmail');
      expect(enriched[0].externalId).toBe('test-1');
      expect(enriched[0].senderName).toBe('Test User');
      expect(enriched[0].priority).toBe('high');
      expect(enriched[0].tags).toContain('existing-tag');
    });
  });
});
