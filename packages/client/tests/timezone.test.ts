// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getTimezone } from '../src/fingerprint/timezone.js'

describe('getTimezone', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the resolved IANA timezone', () => {
    expect(getTimezone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(getTimezone()).not.toBe('')
  })

  it('returns the value reported by Intl', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Asia/Ho_Chi_Minh' }),
    } as unknown as Intl.DateTimeFormat)

    expect(getTimezone()).toBe('Asia/Ho_Chi_Minh')
  })

  it('returns an empty string when the timezone is undefined', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: undefined }),
    } as unknown as Intl.DateTimeFormat)

    expect(getTimezone()).toBe('')
  })

  it('returns an empty string when Intl throws', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('no ICU')
    })

    expect(getTimezone()).toBe('')
  })
})
