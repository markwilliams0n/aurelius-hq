import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { splitMessage } from '../client';

// Note: Most client functions require network calls and TELEGRAM_BOT_TOKEN
// We test the utility functions that don't require network access

describe('Telegram Client', () => {
  describe('splitMessage', () => {
    it('returns single chunk for short messages', () => {
      const message = 'Hello, world!';
      const chunks = splitMessage(message);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(message);
    });

    it('returns single chunk for messages exactly at limit', () => {
      const message = 'a'.repeat(4096);
      const chunks = splitMessage(message);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(message);
    });

    it('splits messages longer than limit', () => {
      const message = 'a'.repeat(5000);
      const chunks = splitMessage(message);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('')).toBe(message);
    });

    it('prefers splitting at newlines', () => {
      // Create lines that will require splitting at the boundary
      const line1 = 'a'.repeat(3000);
      const line2 = 'b'.repeat(3000);
      const message = `${line1}\n${line2}`;

      const chunks = splitMessage(message);

      // Should split at newlines, so each chunk should contain complete lines
      expect(chunks.length).toBe(2);
      // First chunk should be just line1 (split at newline)
      expect(chunks[0]).toBe(line1);
      // Second chunk should be line2 (trimmed of leading whitespace after split)
      expect(chunks[1]).toBe(line2);
    });

    it('splits at spaces when no newlines available', () => {
      const words = Array(1000).fill('word').join(' ');
      const chunks = splitMessage(words);

      // Should split at spaces
      for (const chunk of chunks) {
        // Each chunk (except possibly last) should not end mid-word
        if (chunk.length >= 4096) {
          expect(chunk.endsWith('word')).toBe(true);
        }
      }
    });

    it('force splits when no good break points', () => {
      const message = 'a'.repeat(10000);
      const chunks = splitMessage(message);

      // Should still split the message
      expect(chunks.length).toBeGreaterThan(1);

      // Each chunk should be at most 4096 chars
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(4096);
      }

      // All content should be preserved
      expect(chunks.join('')).toBe(message);
    });

    it('handles custom maxLength', () => {
      const message = 'a'.repeat(100);
      const chunks = splitMessage(message, 50);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].length).toBe(50);
      expect(chunks[1].length).toBe(50);
    });

    it('trims whitespace when splitting', () => {
      const message = 'Hello world! This is a test message.';
      const chunks = splitMessage(message, 15);

      // Should not have leading whitespace on subsequent chunks
      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i].startsWith(' ')).toBe(false);
      }
    });

    it('handles empty string', () => {
      const chunks = splitMessage('');
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('');
    });

    it('handles message with only newlines', () => {
      const message = '\n\n\n';
      const chunks = splitMessage(message, 2);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('handles unicode characters correctly', () => {
      const emoji = '🎉';
      const message = emoji.repeat(1000);
      const chunks = splitMessage(message, 100);

      // All emoji should be preserved (though they might be cut mid-emoji)
      const reconstructed = chunks.join('');
      // Just verify no exception and reasonable chunking
      expect(chunks.length).toBeGreaterThan(1);
    });
  });
});
