import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve({
    get: vi.fn(() => undefined),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}))

// Mock database - getSession uses db in production mode
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
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
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  users: {},
  sessions: {},
  magicLinks: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  gt: vi.fn(),
  isNull: vi.fn(),
}))

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'test-token-123'),
}))

import { getSession } from '../auth'

describe('auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('getSession', () => {
    it('returns mock session in development mode', async () => {
      vi.stubEnv('NODE_ENV', 'development')

      const session = await getSession()

      expect(session).not.toBeNull()
      expect(session?.user.email).toBe('dev@localhost')
    })

    it('returns null in production mode without valid cookie', async () => {
      vi.stubEnv('NODE_ENV', 'production')

      const session = await getSession()

      // Without a valid cookie (mocked to return undefined), should return null
      expect(session).toBeNull()
    })
  })
})
