/**
 * IANA timezone of the device (e.g. 'Asia/Ho_Chi_Minh'), or '' when unavailable.
 */
export function getTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
  } catch {
    return ''
  }
}
