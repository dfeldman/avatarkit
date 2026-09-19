/** The standalone designer page: keeps the avatar in this browser (the console passes its own onSave). */
import { loadSaved, saveLocal } from '../storage.ts'
import { mountDesigner } from './designer.ts'

const params = new URLSearchParams(location.search)
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
