const { app, BrowserWindow, ipcMain, screen, Menu, shell } = require('electron');
const path = require('node:path');
const media = require('./lib/media');
const lyrics = require('./lib/lyrics');

// Card geometry, mirrored in renderer/styles.css. With native vibrancy the
// window itself must be exactly the card, otherwise the blur spills past the
// rounded glass as a frosted rectangle.
const CARD = {
  pill: [132, 32],
  pillPlaying: [200, 32],
  idle: [320, 144],
  base: [428, 300],
  roomy: [428, 384],
};

let win = null;
let hoverTimer = null;
let pollTimer = null;
let polling = false;
let hoverExpanded = false;
let ignoringMouse = true;
let islandState = 'idle';
let lastState = null;

app.setName('Islet');
app.dock?.hide();

function cardSize() {
  if (!hoverExpanded) return islandState === 'idle' ? CARD.pill : CARD.pillPlaying;
  return CARD[islandState] || CARD.base;
}

function fitWindow() {
  if (!win) return;
  const [width, height] = cardSize();
  const { bounds } = screen.getPrimaryDisplay();
  win.setBounds({
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: bounds.y,
    width,
    height,
  });
}

function createWindow() {
  const [width, height] = cardSize();

  win = new BrowserWindow({
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    acceptFirstMouse: true,
    type: 'panel',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  fitWindow();

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    win.showInactive();
    fitWindow();
    watchHover();
    loop();

    if (process.env.ISLET_DEBUG) {
      require('./debug/capture')({
        app,
        win,
        hover: applyHover,
        hitbox,
        stopPolling: () => clearTimeout(pollTimer),
        stopHover: () => clearTimeout(hoverTimer),
      }).catch((err) => console.error('[capture] failed', String(err)));
    }
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.on('closed', () => { win = null; });

  for (const event of ['display-metrics-changed', 'display-added', 'display-removed']) {
    screen.on(event, fitWindow);
  }
}

function hitbox() {
  if (!win) return { x: 0, y: 0, width: 0, height: 0 };
  const { x, y, width, height } = win.getBounds();
  return { x, y, width, height };
}

function cursorInIsland(point) {
  const box = hitbox();
  return (
    point.x >= box.x &&
    point.x < box.x + box.width &&
    point.y >= box.y &&
    point.y < box.y + box.height
  );
}

// Outside the card the window ignores mouse events, so clicks reach whatever is
// behind it. Tracking the real cursor keeps hover reliable without depending on
// hit-testing inside a click-through window.
function applyHover(inside) {
  if (!win) return;

  if (inside !== hoverExpanded) {
    hoverExpanded = inside;
    fitWindow();
    win.webContents.send('expand', inside);
    if (!inside) setTimeout(fitWindow, 200); // let the content fade first
  }

  const shouldIgnore = !inside;
  if (shouldIgnore !== ignoringMouse) {
    ignoringMouse = shouldIgnore;
    win.setIgnoreMouseEvents(shouldIgnore, { forward: true });
  }
}

function watchHover() {
  if (!win) return;
  applyHover(cursorInIsland(screen.getCursorScreenPoint()));
  hoverTimer = setTimeout(watchHover, 90);
}

async function pollOnce() {
  if (!win || polling) return;
  polling = true;
  try {
    lastState = await media.getState();
    if (!win.isDestroyed()) win.webContents.send('media', lastState);
  } catch {
    /* keep the last frame on screen; the next poll retries */
  } finally {
    polling = false;
  }
}

async function loop() {
  await pollOnce();
  if (!win) return;
  pollTimer = setTimeout(loop, lastState?.playing ? 1100 : 3500);
}

ipcMain.handle('media:control', async (_e, action, value) => {
  await media.control(action, value);
  await pollOnce();
});

ipcMain.handle('lyrics:get', async (_e, query) => lyrics.lookup(query));

ipcMain.on('island:state', (_e, state) => {
  if (!CARD[state]) return;
  islandState = state;
  fitWindow();
});

ipcMain.on('shelf:drag', async (event, filePath) => {
  if (!filePath) return;
  try {
    const icon = await app.getFileIcon(filePath, { size: 'small' });
    event.sender.startDrag({ file: filePath, icon });
  } catch {
    /* this file can't be dragged out */
  }
});

ipcMain.on('shelf:reveal', (_e, filePath) => {
  if (filePath) shell.showItemInFolder(filePath);
});

ipcMain.on('app:openAutomation', () => {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Automation');
});

ipcMain.on('app:menu', () => {
  if (!win) return;
  Menu.buildFromTemplate([
    { label: 'Islet', enabled: false },
    { type: 'separator' },
    { label: 'Quit Islet', role: 'quit' },
  ]).popup({ window: win });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  clearTimeout(pollTimer);
  clearTimeout(hoverTimer);
});
