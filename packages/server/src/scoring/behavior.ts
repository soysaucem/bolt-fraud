import type { BehaviorData } from '../model/types.js'

const LOG2_8 = Math.log2(8)

/**
 * Score behavioral signals.
 *   No mouse/keyboard events in snapshot:    +15  no_interaction_events
 *   Mouse entropy too low (linear paths):    +15  mouse_entropy_too_low
 *   Keystroke timing too uniform (bot-like): +10  keystroke_timing_too_uniform
 */
export function scoreBehavior(
  behavior: BehaviorData,
  reasons: string[],
): number {
  let score = 0

  // No interaction events at all — strong bot signal
  if (behavior.totalMouseEvents === 0 && behavior.totalKeyboardEvents === 0) {
    score += 15
    reasons.push('no_interaction_events')
  }

  // Mouse entropy too low (linear paths)
  if (behavior.mouse.length > 2) {
    const entropy = computeMouseEntropy(behavior.mouse)
    if (entropy < 0.1) {
      score += 15
      reasons.push('mouse_entropy_too_low')
    }
  }

  // Keystroke timing too uniform
  if (behavior.keyboard.length > 3) {
    const uniformity = computeKeystrokeUniformity(behavior.keyboard)
    if (uniformity > 0.95) {
      score += 10
      reasons.push('keystroke_timing_too_uniform')
    }
  }

  return score
}

/**
 * Compute normalized Shannon entropy of mouse movement angle changes.
 *
 * Algorithm:
 *   1. Calculate the movement angle (atan2(dy, dx)) between each consecutive pair of events.
 *   2. Bin the angles into 8 equal sectors (each 45°, i.e. π/4 radians wide).
 *   3. Compute Shannon entropy H = -Σ(p * log₂(p)) over non-empty bins.
 *   4. Normalize by log₂(8) = 3 so the result is in [0, 1].
 *
 * Returns:
 *   0.0  — all movements in the same direction (perfectly linear, bot-like)
 *   1.0  — movements equally distributed across all 8 directions (maximum randomness)
 *
 * Falls back to 1.0 (no penalty) when fewer than 3 events are provided.
 */
export function computeMouseEntropy(
  events: readonly { readonly x: number; readonly y: number; readonly t: number }[],
): number {
  if (events.length < 3) return 1.0

  // Count angle occurrences in 8 bins (one per 45° sector)
  const bins: number[] = [0, 0, 0, 0, 0, 0, 0, 0]
  let totalAngles = 0

  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]
    const curr = events[i]

    if (prev === undefined || curr === undefined) continue

    const dx = curr.x - prev.x
    const dy = curr.y - prev.y

    // Skip stationary events (no movement)
    if (dx === 0 && dy === 0) continue

    // atan2 returns angle in [-π, π]; shift to [0, 2π]
    const angle = Math.atan2(dy, dx)
    const normalized = angle < 0 ? angle + 2 * Math.PI : angle

    // Map [0, 2π) to bin index [0, 7]
    const binIndex = Math.min(Math.floor(normalized / (2 * Math.PI / 8)), 7)
    bins[binIndex] = (bins[binIndex] ?? 0) + 1
    totalAngles++
  }

  if (totalAngles === 0) return 1.0

  // Shannon entropy: H = -Σ p * log₂(p)
  let entropy = 0
  for (const count of bins) {
    if (count === 0) continue
    const p = count / totalAngles
    entropy -= p * Math.log2(p)
  }

  // Normalize to [0, 1]
  return entropy / LOG2_8
}

/**
 * Compute how uniform keystroke inter-key timing is.
 *
 * Algorithm:
 *   1. Compute inter-key intervals: intervals[i] = events[i+1].t - events[i].t
 *   2. Calculate mean and standard deviation of intervals.
 *   3. Coefficient of variation (CV) = stddev / mean.
 *      Low CV → highly uniform → bot-like.
 *   4. Return 1 - min(CV, 1).
 *      High uniformity (low CV, e.g. < 0.05) → return close to 1.
 *      High variation (human-like, CV > 0.3)  → return close to 0.7 or lower.
 *
 * Returns value in [0, 1] where:
 *   ~1.0  = perfectly uniform (bot-like, CV ≈ 0)
 *   ~0.0  = highly variable (human-like, CV ≥ 1)
 *
 * Falls back to 0 (no penalty) when fewer than 2 events are provided.
 */
export function computeKeystrokeUniformity(
  events: readonly { readonly t: number }[],
): number {
  if (events.length < 2) return 0

  const intervals: number[] = []
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]
    const curr = events[i]
    if (prev === undefined || curr === undefined) continue
    intervals.push(curr.t - prev.t)
  }

  if (intervals.length === 0) return 0

  const n = intervals.length
  const mean = intervals.reduce((sum, v) => sum + v, 0) / n

  // Avoid division by zero if all events at same timestamp
  if (mean === 0) return 1.0

  const variance = intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n
  const stddev = Math.sqrt(variance)
  const cv = stddev / mean

  // 1 - min(CV, 1): high CV → low uniformity; low CV → high uniformity (bot)
  return 1 - Math.min(cv, 1)
}
