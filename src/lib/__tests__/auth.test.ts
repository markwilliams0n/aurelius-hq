import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock next/headers before importing auth
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve({
    get: vi.fn(() => undefined),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}))

describe('auth', () => {
  const originalEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
    vi.resetModules()
    vi.clearAllMocks()
  })

  describe('getSession', () => {
    it('returns mock session in development mode', async () => {
      process.env.NODE_ENV = 'development'

      // Dynamic import to get fresh module with new env
      const { getSession } = await import('../auth')

      const session = await getSession()

      expect(session).not.toBeNull()
      expect(session?.user.email).toBe('dev@localhost')
    })

    it('returns null in production mode without valid cookie', async () => {
      process.env.NODE_ENV = 'production'

      // Dynamic import to get fresh module with new env
      const { getSession } = await import('../auth')

      // Without a valid cookie (mocked to return undefined), should return null
      const session = await getSession()

      expect(session).toBeNull()
    })
  })
})
