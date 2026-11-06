// Builds unsigned, portable app folders for Windows, macOS and Linux.
//   node scripts/package.mjs [platform ...]   e.g. win32 linux darwin (default: all three)
import { packager } from '@electron/packager'

const all = { win32: ['x64'], linux: ['x64'], darwin: ['universal'] }
const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(all)
for (const platform of want) {
  if (!all[platform]) throw new Error(`unknown platform ${platform}`)
  const paths = await packager({
    dir: '.',
    out: 'out',
    overwrite: true,
    platform,
    arch: all[platform],
    asar: true,
    prune: true,
    name: 'Apex Drift',
    executableName: platform === 'linux' ? 'apex-drift' : 'Apex Drift',
    icon: 'icon',
    appBundleId: 'com.tomicstudios.apexdrift',
    appCopyright: 'Tomić Studios',
    appVersion: '3.0.0',
    ignore: [/^\/out($|\/)/, /^\/scripts($|\/)/, /^\/README\.md$/],
    win32metadata: { CompanyName: 'Tomić Studios', ProductName: 'Apex Drift', FileDescription: 'Apex Drift' },
  })
  console.log(paths.join('\n'))
}
