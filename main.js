// Waypoint X – Mitarbeiter-App
// Eigenes Programmfenster, das ausschließlich die Waypoint-X-Web-App lädt.
// Keine Adressleiste, keine Tabs, kein Menü, keine Entwicklerwerkzeuge.
// Links zu anderen Seiten (z. B. Verträge in Google Docs) öffnen im normalen Browser.

const { app, BrowserWindow, Menu, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_NAME = 'Waypoint X';
const HINTERGRUND = '#0B0B0C';

// Diese Adressen darf das Fenster selbst anzeigen – alles andere geht in den Browser.
const ERLAUBTE_HOSTS = [/^script\.google\.com$/, /(^|\.)googleusercontent\.com$/];

function ladeUrl() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    const url = String(cfg.url || '').trim();
    return /^https:\/\/script\.google\.com\/.+\/exec$/.test(url) ? url : null;
  } catch (e) {
    return null;
  }
}

function erlaubt(adresse) {
  try {
    const u = new URL(adresse);
    if (u.protocol === 'file:') return true; // eigene Lade- und Fehlerseite
    return u.protocol === 'https:' && ERLAUBTE_HOSTS.some(re => re.test(u.hostname));
  } catch (e) {
    return false;
  }
}

function extern(adresse) {
  if (/^https?:\/\//i.test(adresse) || /^mailto:/i.test(adresse)) shell.openExternal(adresse);
}

// --- Fenstergröße merken -----------------------------------------------------
const zustandDatei = () => path.join(app.getPath('userData'), 'fenster.json');
function ladeZustand() {
  try { return JSON.parse(fs.readFileSync(zustandDatei(), 'utf8')); } catch (e) { return {}; }
}
function speichereZustand(win) {
  try {
    const z = { ...win.getNormalBounds(), maximiert: win.isMaximized() };
    fs.writeFileSync(zustandDatei(), JSON.stringify(z));
  } catch (e) { /* egal */ }
}

// --- Nur eine Instanz --------------------------------------------------------
let fenster = null;
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!fenster) return;
    if (fenster.isMinimized()) fenster.restore();
    fenster.focus();
  });
}

app.setAppUserModelId('com.waypointx.app');
Menu.setApplicationMenu(null);

function seite(name, params) {
  return fenster.loadFile(path.join(__dirname, name), { query: params || {} });
}

function oeffneApp() {
  const url = ladeUrl();
  if (!url) return seite('fehler.html', { art: 'konfig' });
  return fenster.loadURL(url);
}

function erstelleFenster() {
  const z = ladeZustand();
  fenster = new BrowserWindow({
    title: APP_NAME,
    icon: path.join(__dirname, 'icon.ico'),
    width: z.width || 1440,
    height: z.height || 900,
    x: z.x, y: z.y,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: HINTERGRUND,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      partition: 'persist:waypointx',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });
  if (z.maximiert) fenster.maximize();

  const wc = fenster.webContents;

  // Titel immer "Waypoint X"
  fenster.on('page-title-updated', e => e.preventDefault());

  // Navigation nur innerhalb der Web-App
  wc.on('will-navigate', (e, adresse) => {
    if (adresse.startsWith('waypointx://neu-laden')) { e.preventDefault(); oeffneApp(); return; }
    if (!erlaubt(adresse)) { e.preventDefault(); extern(adresse); }
  });
  wc.on('will-redirect', (e, adresse) => {
    if (!erlaubt(adresse)) { e.preventDefault(); extern(adresse); }
  });
  // Neue Fenster / target=_blank -> normaler Browser
  wc.setWindowOpenHandler(({ url }) => { extern(url); return { action: 'deny' }; });

  // Seite nicht erreichbar -> eigene Fehlerseite mit "Erneut versuchen"
  wc.on('did-fail-load', (e, code, beschreibung, adresse, hauptframe) => {
    if (!hauptframe || code === -3) return; // -3 = abgebrochen (normal bei Weiterleitungen)
    seite('fehler.html', { art: 'offline', code: String(code) });
  });

  // Tastenkürzel: F5/Strg+R neu laden, F11 Vollbild, Strg +/-/0 Zoom
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const strg = input.control || input.meta;
    const taste = input.key.toLowerCase();
    if (taste === 'f5' || (strg && taste === 'r')) { e.preventDefault(); oeffneApp(); }
    else if (taste === 'f11') { e.preventDefault(); fenster.setFullScreen(!fenster.isFullScreen()); }
    else if (strg && (taste === '+' || taste === '=')) { e.preventDefault(); wc.setZoomLevel(wc.getZoomLevel() + 0.5); }
    else if (strg && taste === '-') { e.preventDefault(); wc.setZoomLevel(wc.getZoomLevel() - 0.5); }
    else if (strg && taste === '0') { e.preventDefault(); wc.setZoomLevel(0); }
    else if (app.isPackaged && (taste === 'f12' || (strg && input.shift && ['i', 'j', 'c'].includes(taste)))) e.preventDefault();
  });

  fenster.once('ready-to-show', () => fenster.show());
  fenster.on('close', () => speichereZustand(fenster));
  fenster.on('closed', () => { fenster = null; });

  seite('laden.html').then(() => setTimeout(oeffneApp, 150));
}

app.whenReady().then(() => {
  // Keine Berechtigungen (Kamera, Mikrofon, Standort, Benachrichtigungen …)
  const ses = session.fromPartition('persist:waypointx');
  ses.setPermissionRequestHandler((wc, recht, ok) => ok(recht === 'clipboard-sanitized-write'));
  // Downloads (z. B. aus Google Docs) im normalen Download-Ordner ablegen
  ses.on('will-download', (e, item) => {
    item.setSavePath(path.join(app.getPath('downloads'), item.getFilename()));
  });
  erstelleFenster();
});

app.on('window-all-closed', () => app.quit());
