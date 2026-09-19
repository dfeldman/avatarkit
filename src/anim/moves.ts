/**
 * Moves: the motion clips worth offering a player, named for people rather than animators, with the hand pose each
 * wants. A move is one clip or a short run of them (a jump takes off, then lands). Clips that need a prop or a seat
 * the scene doesn't have (pistols, sitting, driving), aiming holds and transitions are left out, and so are walking
 * and running: those are procedural (Quaternius' jog and sprint hold the arms 45–50° out from the side, for its
 * chunky character). A game can still play any clip by name (`avatar.animator.play('Sitting_Idle_Loop')`).
 */
import type { HandPose } from './hands.ts'

export interface Move {
  id: string
  label: string
  ico: string
  group: 'Everyday' | 'Sport' | 'Action'
  /** the clips, in order (the last one holds if it loops) */
  clips: string[]
  /** the hands while it plays */
  hands: HandPose
  /** for moves that travel: the ground's speed under the feet (m/s), for a treadmill or a scrolling floor */
  ground?: number
}

export const MOVES: Move[] = [
  { id: 'idle', label: 'Idle', ico: '🧍', group: 'Everyday', clips: ['Idle_Loop'], hands: 'relaxed' },
  { id: 'chat', label: 'Chat', ico: '💬', group: 'Everyday', clips: ['Idle_Talking_Loop'], hands: 'open' },
  { id: 'use', label: 'Use', ico: '🫳', group: 'Everyday', clips: ['Interact'], hands: 'open' },
  { id: 'pickup', label: 'Pick up', ico: '📦', group: 'Everyday', clips: ['PickUp_Table'], hands: 'open' },
  { id: 'push', label: 'Push', ico: '🛒', group: 'Everyday', clips: ['Push_Loop'], hands: 'open', ground: 0.8 },
  { id: 'fix', label: 'Fix', ico: '🔧', group: 'Everyday', clips: ['Fixing_Kneeling'], hands: 'fist' },
  { id: 'crouch', label: 'Crouch', ico: '🧎', group: 'Everyday', clips: ['Crouch_Idle_Loop'], hands: 'relaxed' },
  { id: 'sneak', label: 'Sneak', ico: '🐾', group: 'Everyday', clips: ['Crouch_Fwd_Loop'], hands: 'relaxed', ground: 0.9 },
  { id: 'dance', label: 'Dance', ico: '💃', group: 'Sport', clips: ['Dance_Loop'], hands: 'open' },
  { id: 'jump', label: 'Jump', ico: '🦘', group: 'Sport', clips: ['Jump_Start', 'Jump_Land'], hands: 'relaxed' },
  { id: 'roll', label: 'Roll', ico: '🤸', group: 'Sport', clips: ['Roll'], hands: 'fist' },
  { id: 'swim', label: 'Swim', ico: '🏊', group: 'Sport', clips: ['Swim_Fwd_Loop'], hands: 'open' },
  { id: 'jab', label: 'Jab', ico: '👊', group: 'Action', clips: ['Punch_Jab'], hands: 'fist' },
  { id: 'cross', label: 'Cross', ico: '🥊', group: 'Action', clips: ['Punch_Cross'], hands: 'fist' },
  { id: 'swing', label: 'Swing', ico: '⚔️', group: 'Action', clips: ['Sword_Attack'], hands: 'fist' },
  { id: 'cast', label: 'Cast', ico: '✨', group: 'Action', clips: ['Spell_Simple_Shoot'], hands: 'open' },
  { id: 'hit', label: 'Hit', ico: '💥', group: 'Action', clips: ['Hit_Chest'], hands: 'open' },
  { id: 'fall', label: 'Fall', ico: '😵', group: 'Action', clips: ['Death01'], hands: 'relaxed' },
]

export const moveFor = (id: string): Move | undefined => MOVES.find((m) => m.id === id)
