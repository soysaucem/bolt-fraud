import type { AutomationResult, IntegrityResult } from '../types.js'
import { detectAutomation } from './automation.js'
import { validateIntegrity } from './integrity.js'

export interface DetectionResult {
  readonly isAutomated: boolean
  readonly signals: AutomationResult['signals']
  readonly integrity: IntegrityResult
}

export async function runDetection(): Promise<DetectionResult> {
  const [automation, integrity] = await Promise.all([
    detectAutomation(),
    validateIntegrity(),
  ])
  return {
    isAutomated: automation.isAutomated,
    signals: automation.signals,
    integrity,
  }
}
