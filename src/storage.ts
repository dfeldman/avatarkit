/** The player's avatar in this browser (the standalone designer's save slot). Games on the platform read the profile instead. */
import { normalizeSpec, type AvatarSpec } from './spec.ts'

export const STORAGE_KEY = 'dh.avatar'

export function loadSaved(): AvatarSpec | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? normalizeSpec(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function saveLocal(spec: AvatarSpec): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(spec))
    return true
  } catch {
    return false
  }
}
