/** The standalone designer page: keeps the avatar in this browser (the console passes its own onSave). */
import { loadSaved, saveLocal } from '../storage.ts'
import { mountDesigner } from './designer.ts'
import { loadFromBucket } from '../body/bucket.ts'

const params = new URLSearchParams(location.search)
// ?bucket loads every asset from the shared assetmgr bucket instead of a local copy of public/ (?bucket=<url> for another)
if (params.has('bucket')) await loadFromBucket(params.get('bucket') || undefined)
const theme = params.get('theme')
const host = document.getElementById('app')!
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = host.dataset.theme = theme
const designer = await mountDesigner(host, {
  initial: loadSaved() ?? undefined,
  onSave: (spec) => {
    if (!saveLocal(spec)) throw new Error('this browser won’t keep it')
  },
})
;(window as unknown as { __designer: typeof designer }).__designer = designer
