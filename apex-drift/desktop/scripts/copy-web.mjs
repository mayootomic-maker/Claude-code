// Copies the built game (web/dist) into the desktop app. Run `npm run build` in web/ first.
import { cpSync, existsSync, rmSync } from 'node:fs'

const src = new URL('../../web/dist/', import.meta.url)
const dst = new URL('../www/', import.meta.url)
if (!existsSync(new URL('index.html', src))) {
  console.error('web/dist is missing: run `npm run build` in apex-drift/web first.')
  process.exit(1)
}
rmSync(dst, { recursive: true, force: true })
cpSync(src, dst, { recursive: true })
console.log('copied web/dist -> desktop/www')
