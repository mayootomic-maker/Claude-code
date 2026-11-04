import './styles.css'
import { App } from './app'
import { t } from './game/i18n'

/** WebGL 2 is required; say so plainly instead of showing a black screen. */
function webgl2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

const canvas = document.getElementById('gl') as HTMLCanvasElement
const rotate = document.querySelector('#rotate p')
if (rotate) rotate.textContent = t('rotate')
if (!webgl2()) {
  const el = document.createElement('div')
  el.id = 'fatal'
  el.innerHTML = `<p>${t('noWebgl')}</p>`
  document.body.appendChild(el)
} else {
  const app = new App(canvas)
  ;(window as unknown as { __app: App }).__app = app
}
