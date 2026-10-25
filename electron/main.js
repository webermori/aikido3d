import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol } from 'electron';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const configFile = () => path.join(app.getPath('userData'), 'config.json');

protocol.registerSchemesAsPrivileged([
  { scheme: 'aikido', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const isAssetRoot = (dir) => !!dir && existsSync(path.join(dir, 'Data', 'Clips')) && existsSync(path.join(dir, 'Media', 'VisualCommon'));

function savedRoot() {
  try { return JSON.parse(readFileSync(configFile(), 'utf8')).assets; } catch { return null; }
}

async function pickRoot(win) {
  const res = await dialog.showOpenDialog(win, {
    title: 'Select the extracted Aikido3D folder (contains Data and Media)',
    properties: ['openDirectory'],
  });
  const dir = res.filePaths[0];
  if (!res.canceled && !isAssetRoot(dir)) {
    await dialog.showMessageBox(win, { type: 'error', message: 'That folder does not contain Data\\Clips and Media\\VisualCommon.' });
    return null;
  }
  if (dir) writeFileSync(configFile(), JSON.stringify({ assets: dir }));
  return res.canceled ? null : dir;
}

let assetRoot = [
  app.commandLine.getSwitchValue('assets'),
  process.env.AIKIDO3D_ASSETS,
  savedRoot(),
  path.resolve(app.getAppPath(), 'extracted'),
].find(isAssetRoot) ?? null;

function listClips() {
  const clipsDir = path.join(assetRoot, 'Data', 'Clips');
  return readdirSync(clipsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ id: d.name, files: readdirSync(path.join(clipsDir, d.name)) }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, backgroundColor: '#14161a', title: 'Aikido 3D — Volume One',
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(here, '..', 'dist', 'index.html'));
  return win;
}

app.whenReady().then(async () => {
  protocol.handle('aikido', async (req) => {
    if (!assetRoot) return new Response('No asset folder selected', { status: 404 });
    const rel = decodeURIComponent(new URL(req.url).pathname);
    const file = path.resolve(assetRoot, '.' + rel);
    const inside = path.relative(assetRoot, file);
    if (inside.startsWith('..') || path.isAbsolute(inside)) return new Response('Forbidden', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).toString());
    // The renderer runs from file://, so asset responses must be readable cross-origin.
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(res.body, { status: res.status, headers });
  });

  ipcMain.handle('assets:info', () => ({ root: assetRoot, clips: assetRoot ? listClips() : [] }));
  ipcMain.handle('assets:choose', async (e) => {
    const dir = await pickRoot(BrowserWindow.fromWebContents(e.sender));
    if (dir) assetRoot = dir;
    return !!dir;
  });

  const win = createWindow();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Choose assets folder…', click: async () => { const d = await pickRoot(win); if (d) { assetRoot = d; win.reload(); } } },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
  ]));
});

app.on('window-all-closed', () => app.quit());
