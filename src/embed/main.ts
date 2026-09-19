/**
 * How a host page (the Dandyhorse console) embeds the designer: mount it on an element, hand it the player's
 * current avatar, store what it saves, dispose it when the page goes away. Saving here pretends to be
 * PUT /api/me; ?fail=1 makes it fail so the error toast can be seen.
 */
import { mountDesigner } from '../designer/designer.ts'
import { encodeSpec, normalizeSpec, type AvatarSpec } from '../spec.ts'

const params = new URLSearchParams(location.search)
const log = document.getElementById('log')!
const slot = document.getElementById('slot')!
let profile: { bio: string; avatar?: AvatarSpec } = { bio: 'hello', avatar: normalizeSpec({ hair: { style: 'bun' } }) }

const designer = await mountDesigner(slot, {
  initial: profile.avatar,
  title: 'Edit avatar',
  onSave: async (avatar) => {
    await new Promise((r) => setTimeout(r, 300))
    if (params.has('fail')) throw new Error('the server said no')
    // PUT /api/me replaces the whole profile object, so send it all back
    profile = { ...profile, avatar }
    log.textContent = `saved ${encodeSpec(avatar)}`
  },
})

document.getElementById('close')!.addEventListener('click', () => {
  designer.dispose()
  log.textContent = 'closed'
})
;(window as unknown as { __embed: unknown }).__embed = { designer, get profile() { return profile } }
