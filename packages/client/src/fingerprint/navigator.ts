import type { NavigatorInfo } from '../types.js'

/**
 * Collect stable navigator properties. Excludes volatile props
 * (geolocation, battery) for cacheable fingerprints.
 */
export function getNavigatorInfo(): NavigatorInfo {
  if (typeof navigator === 'undefined') {
    return {
      userAgent: '',
      language: '',
      languages: [],
      platform: '',
      hardwareConcurrency: 0,
      deviceMemory: null,
      maxTouchPoints: 0,
      cookieEnabled: false,
      doNotTrack: null,
      vendor: '',
      pluginCount: 0,
    }
  }

  const nav = navigator as Navigator & {
    deviceMemory?: number
    oscpu?: string
    buildID?: string
  }

  return {
    userAgent: nav.userAgent ?? '',
    language: nav.language ?? '',
    languages: Array.from(nav.languages ?? []),
    platform: nav.platform ?? '',
    hardwareConcurrency: nav.hardwareConcurrency ?? 0,
    deviceMemory: nav.deviceMemory ?? null,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    cookieEnabled: nav.cookieEnabled ?? false,
    doNotTrack: nav.doNotTrack ?? null,
    vendor: nav.vendor ?? '',
    pluginCount: nav.plugins?.length ?? 0,
  }
}
