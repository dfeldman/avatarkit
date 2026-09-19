# Avatar Kit on Dandyhorse

This is what it takes to give every Dandyhorse player one avatar that all games show. It covers only the points
where the kit and the platform (`~/dandyhorse`) meet. [README.md](README.md) describes the kit itself.

Nothing on the platform has been changed. §7 lists the platform changes as proposals. Each one is small.

## 1. The shape of it

```
console Preferences ─► mountDesigner(...) ─► PUT /api/me { profile: { ...profile, avatar } }
game ─► startsession ─► payload.avatar (proposed, §7.1) ─► GeometryService (worker) ─► new Avatar(scene, avatar)
getstate (1 Hz) ─► speed / cadence / incline + EffortMeter ─► avatar.setMotion(...) ─► walk, run or ride
```

- **Location:** the kit is a TypeScript-source package, like `libs/gamekit`. It would fit at
  `dandyhorse/libs/avatarkit`, the way devicelib moved in. Games would then add
  `"@dandyhorse/avatarkit": "file:../../libs/avatarkit"` and `@babylonjs/core` 9.26.0. Until it moves, the same
  dependency works as `file:` + the path to `~/avatarkit`.
- **Two entries:**
  - `@dandyhorse/avatarkit` is for games: spec, `Avatar`, `GeometryService`, `Bike`, `Animator`.
  - `@dandyhorse/avatarkit/designer` is for the console. It adds DOM code and CSS, which no game needs.

## 2. Storing the avatar — done

(`consoles/web/src/avatar.ts` and `views/Avatar.vue`; the server caps the profile at 32 KB.)

- **Where:** in `users.profile.avatar`. PLAN.md §8.1 already lists "avatar" among the profile JSON's contents.
- **The value:** an `AvatarSpec`, a versioned JSON object of about 1 KB (the default is in README.md). Readers
  run `normalizeSpec`, which fills in missing fields and drops unknown values, so old, partial or hand-edited
  avatars are always safe.
- **Writing it:** `PUT /api/me` replaces the whole `profile` object (`consoleapi.py`: `profile=?`). The console
  must send the profile it read with only the avatar changed:

  ```ts
  const me = await api.get('/api/me')
  await api.put('/api/me', { profile: { ...me.profile, avatar } })
  ```

- **Public profiles:** `GET /api/users/<username>` already returns the profile, and so the avatar, for public
  users. That is enough to show other people's avatars later (leaderboards, ghosts; §7.3).
- **Sharing:** avatar codes (`AV2-…`, short: only what differs from the default) let a player carry a look to another account or device
  without any server support. The designer's Extras tab has Copy and Use buttons.

## 3. The console: editing

The designer is a self-contained widget. It renders into a shadow root, so the console's `style.css` and the
designer's styles cannot affect each other. `/embed.html` in this repo is a working example. It uses a host page
with deliberately clashing CSS, a fake `PUT /api/me` (add `?fail=1` to see a failed save) and a Close button.

```vue
<!-- views/Avatar.vue (or a section of Preferences.vue) -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Designer } from '@dandyhorse/avatarkit/designer'
import { api } from '../api'

const host = ref<HTMLElement>()
let designer: Designer | null = null

onMounted(async () => {
  // loaded on demand: the designer brings Babylon (about 1.5 MB gzipped) that the rest of the console doesn't need
  const { mountDesigner } = await import('@dandyhorse/avatarkit/designer')
  const me = await api.get('/api/me')
  host.value!.dataset.theme = document.documentElement.dataset.theme ?? ''
  designer = await mountDesigner(host.value!, {
    initial: me.profile?.avatar,
    title: 'Your avatar',
    onSave: async (avatar) => {
      const fresh = await api.get('/api/me')                 // don't overwrite a bio edited elsewhere meanwhile
      await api.put('/api/me', { profile: { ...fresh.profile, avatar } })
    },
  })
})
onBeforeUnmount(() => designer?.dispose())
</script>

<template><div ref="host" class="avatar-host" /></template>
<style scoped>.avatar-host { height: calc(100dvh - var(--topbar-height, 72px)); }</style>
```

- **Size:** the host needs a height on wide screens, and the designer fills it. On phones (under 860 px) the
  designer stacks and grows, and the page scrolls.
- **Theme:** copy the console's `data-theme` onto the host. Without it, the designer follows the system theme.
  Watch for theme changes if the console can switch while the designer is open.
- **Errors:** `onSave` may throw, and its message is shown to the player ("Couldn't save: …").
- **Remote / d-pad:** `focus.ts` collects focusable elements with `root.querySelectorAll`, which stops at
  shadow roots, so the remote can't reach the designer's buttons yet. The fix is small (§7.2): walk open
  `shadowRoot`s when collecting, and follow `activeElement` into them. Every designer control is a real
  `button` or `input` with visible focus, so once the remote can see them they work like the rest of the
  console. Sliders take ←/→ natively.
- **Where in the console:** Preferences → Avatar, and optionally a step in the first-run flow (PLAN.md §17).
- **Build:** the designer imports its CSS with `?inline`, which Vite handles. Add Babylon to the console
  (`@babylonjs/core` 9.26.0) and dedupe it (§5).

## 4. Games: showing the player

- **Getting the avatar:**
  - Proposed: the `startsession` payload carries it (§7.1).
  - Until then, a game running on the platform's origin can read `GET /api/me` with the session cookie. That
    is a stopgap, since games otherwise use only `/gameapi`.
  - With no avatar at all, `normalizeSpec(undefined)` gives the default look. `randomSpec(seed)` is good for
    rivals and crowds.

```ts
import { Avatar, Bike, GeometryService, normalizeSpec, setAssetBase, suggestQuality } from '@dandyhorse/avatarkit'
import { EffortMeter, SessionClient, startSession } from '@dandyhorse/gamekit'

const start = await startSession(...)
const spec = normalizeSpec((start as { avatar?: unknown }).avatar)
setAssetBase('https://…/avatarkit/mh/')                      // the kit's public/mh/, served from the platform's CDN
const quality = suggestQuality(engine)                       // medium on phones, high on desktops
const geometry = new GeometryService()                       // one per page: one worker, 40 bodies cached
const player = new Avatar(scene, spec, { geometry: (await geometry.request(spec, quality))!, quality, shadows })
const meter = new EffortMeter({ deviceType: start.deviceType, preferences: start.preferences, bodyData: start.bodyData })
const bike = start.deviceType === 'bike' ? new Bike(scene, player.animator.fit, { color: spec.clothes[0]?.color ?? '#1f6bff' }) : null
if (bike) bike.root.parent = player.root

// in onState (about 1 Hz); the avatar smooths between readings itself, and a null reading keeps the last motion
meter.update(state, now)                                     // (as the game already does for effort)
const effort = Math.min(1, meter.value(now) / 1.5)          // 1 = the player's steady pace
const cadence = state.cadence.actual, speed = state.speed.actual
player.setExpression('effort', Math.max(0, effort - 0.6) / 0.6)  // the face shows the work above the steady pace
if (start.deviceType === 'bike') {
  if (cadence !== null) player.setMotion({ mode: 'cycle', cadence, speed: world.speed, effort })
} else if (speed !== null) {
  // 'walk' turns into a run by itself above about 2.6 m/s
  player.setMotion({ mode: speed > 0.2 ? 'walk' : 'idle', speed, grade: (state.incline.actual ?? 0) / 100, effort })
}

// every frame
player.update(dt)
bike?.update(player.animator.crank, world.speed * dt)
```

- **Readings:** speeds are m/s, cadence is rpm and incline is a percent, as `getstate` sends them.
- **Missing data:** a `null` reading means "no data" and should keep the last motion, not stop the avatar.
- **Pauses:** when the session pauses, set `mode: 'idle'` (or `cadence: 0` on a bike, which keeps the feet on
  the pedals).
- **Pedals and the real crank:** for a bike with a real crank angle, pass `crank` (radians, right pedal up = 0)
  and the pedals follow it exactly. Cadence alone is fine for most games.
- **Walking and running on a treadmill:** with `mode: 'walk'`, the avatar walks up to about 2.6 m/s and runs
  above that. `mode: 'run'` jogs even at slow speeds.
- **Hills:** `grade` tilts the feet and posture. A game that moves the avatar over terrain places
  `avatar.root` on the ground itself; the root is at the feet.
- **Cost:**
  - A body builds in 40–80 ms once its assets are loaded; the first avatar waits on its downloads (about 1.4 MB
    at low, 4.5 MB at medium or high, plus the 1.5 MB studio HDRI if the game uses `lightStage`). Load the player
    first, and show rivals as they arrive.
  - Use `low` for rivals and crowds (MakeHuman's low-poly body, lighter garments and textures), and
    `suggestQuality(engine)` for the player.
  - A change of clothes or hair is a rebuild; colours, skin settings and expressions aren't.
  - Expressions: `player.setExpression(name, strength)` holds until changed; blinking is automatic.
  - Hands: `player.setHands('fist')` (or `'relaxed'`, `'open'`, `'point'`) eases in and holds; riders grip the bars
    on their own.
  - Moves: `player.animator.useClips(await loadClips())` once (about 1.2 MB), then `player.animator.play(name)` for
    a celebration, a wave of effort, a fall. `MOVES` lists the ones the designer offers, with the hand pose each wants.
  - `GeometryService.request(spec, q, { latest: true })` drops queued builds that a newer one replaced, which
    is useful for previews.
- **Session images (PLAN.md §6.7):** nothing to do. An avatar on screen is in the frame.
- **Your own bike model:** read `player.animator.fit` (bottom bracket, crank length, pedal spacing, saddle,
  grips, wheel radius) and scale your model to it. The rider's feet and hands go exactly there.

## 5. Build notes

- **The assets:** `public/mh/` (MakeHuman's targets, garments, hair, skins and textures, about 330 MB in all) and
  `public/env/` (the studio HDRI) are served as static files, and each avatar fetches only what its spec needs.
  Serve them from the platform's CDN with long cache lifetimes and compression for the `.bin` files, and point
  `setAssetBase` at them. They are rebuilt by `tools/` from MakeHuman's data (see README.md); CC-BY credits are in
  CREDITS.md and `credits()`.
- **TypeScript source:** like gamekit, the kit ships its TypeScript source, and the game's Vite compiles it.
- **The worker:** it is referenced with `new URL('./geometry.worker.ts', import.meta.url)`. Vite emits it as
  its own 35 KB chunk with no Babylon in it (checked in this repo's production build). Without workers (or if
  the worker fails to load), `GeometryService` builds on the main thread instead.
- **One Babylon:** the kit has its own development copy of `@babylonjs/core`. A `file:` link can make Vite
  bundle that copy next to the game's, and two Babylons break materials and `instanceof` checks. Add this to
  the game's `vite.config.ts`:

  ```ts
  resolve: { dedupe: ['@babylonjs/core'] },
  ```

- **Versions:** the kit expects `@babylonjs/core` 9.26.0 (a peer dependency), the same version the games pin.

## 6. Classic-script games (Babylon from the CDN)

Rolling Hills and Bikeplane load Babylon as the global `BABYLON` and run classic scripts, so they can't import
this package. When one of them wants riders (bikebike's "competitors later"), the way in is a second build of
the kit:
- Vite library mode, IIFE format, exposing `window.AvatarKit`.
- `@babylonjs/core` marked external and mapped to the global `BABYLON`.
- The worker inlined.

That is roughly 20 lines of config and a test page. It is not built yet.

## 7. Platform changes this needs (proposals)

1. **The avatar in the start payload.** In `servers/api-flask/dandyhorse/api/gameapi.py` (`startsession`),
   add this next to `"bodyData"`:
   ```python
   "avatar": (user.get("profile") or {}).get("avatar"),
   ```
   In `libs/gamekit/src/types.ts`, add `avatar?: Json | null` to `StartPayload`, and add a line about it to
   GAME_AUTHORING.md §6.1.
2. **An avatar page in the console:** §3's component, loaded on demand. Also teach `focus.ts` to look inside
   open shadow roots:
   ```ts
   export function focusables(root: Element | ShadowRoot): HTMLElement[] {
     const out: HTMLElement[] = []
     for (const el of root.querySelectorAll<HTMLElement>('*')) {
       if (el.matches(FOCUSABLE) && visible(el)) out.push(el)
       if (el.shadowRoot) out.push(...focusables(el.shadowRoot))
     }
     return out
   }
   // and for "where is focus now": let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement
   ```
3. **Later: other players' avatars** for ghosts and leaderboards. `GET /gameapi/avatars?users=a,b` would
   return `{ username: spec }`, for public profiles or players in the same group. This is small, cacheable and
   only needed once a game shows other people.
4. **Optional: a size cap.** The server could reject a `profile.avatar` over about 4 KB. Nothing else needs
   checking there, because every reader normalizes.
5. **Moving the kit** into `libs/avatarkit`, with a short "Show the player" section in
   GAME_DEVELOPER_GUIDE.md that points at §4.

## 8. Open decisions for you

- **Location:** should the kit move into `dandyhorse/libs/`, or stay a standalone project the games link to?
- **The stopgap:** may games read `/api/me` for the avatar until the payload carries it?
- **Privacy:** should an avatar be visible on public profiles, and to other players in shared games, by
  default?
- **Walk or run on a treadmill:** is the automatic switch at 2.6 m/s right, or should it be a preference
  (for race-walkers, or runners who jog slowly)?
