// Apex Drift desktop shell. The game is the same web build the Android app
// ships, served from inside the app over a private app:// scheme: module
// scripts and the engine-sound AudioWorklet refuse to load from file://.
const { app, BrowserWindow, protocol, net, shell, ipcMain, Menu } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const WWW = path.join(__dirname, 'www')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

// A zip has no way to install chrome-sandbox setuid root, and Ubuntu 24.04+
// blocks the namespace sandbox for unpackaged apps, so Electron would refuse to
// start. The window only ever loads the game bundled inside the app and
// navigation out is blocked below, so nothing untrusted runs in it.
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox')

// One copy at a time: two windows would fight over the same save.
if (!app.requestSingleInstanceLock()) app.quit()

let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#0b0d10',
    title: 'Apex Drift',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // A rally game should keep its frame rate when another window has focus.
      backgroundThrottling: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  win.loadURL('app://apex/index.html')

  // F11 toggles fullscreen as players expect; the game itself handles F.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen())
      e.preventDefault()
    }
  })
  // The game never navigates; any link out goes to the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://apex/')) e.preventDefault()
  })
  win.on('closed', () => {
    win = null
  })
}

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

ipcMain.on('apex:exit', () => app.quit())

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url)
    const file = path.normalize(path.join(WWW, decodeURIComponent(pathname)))
    // Never serve anything outside the bundled game.
    if (file !== WWW && !file.startsWith(WWW + path.sep)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())
