/* End-to-End-Test im echten Browser (optional).
   Voraussetzung: Playwright + Chromium.  Start:  node tests/e2e.js
   Laedt echte Minen-Daten von terramine.app (eine Anfrage pro Lauf). */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8137;
const POS = { latitude: 40.7040, longitude: -73.9940 };   // dichter Bereich in New York
const OUT = process.env.SHOT_DIR || path.join(ROOT, '.screenshots');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    server.listen(PORT, () => resolve(server));
  });
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail && !ok ? '  → ' + detail : ''));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const launch = {};
  if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
  // In abgeschotteten Umgebungen laeuft der Browser ueber den lokalen Proxy.
  // HTTPS ueber den Proxy, HTTP (der lokale Testserver) direkt.
  if (process.env.HTTPS_PROXY) launch.proxy = { server: 'http=direct://;https=' + process.env.HTTPS_PROXY };
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },   // iPhone-Format
    deviceScaleFactor: 2,
    geolocation: POS,
    permissions: ['geolocation', 'clipboard-read', 'clipboard-write'],
    locale: 'de-DE',
    ignoreHTTPSErrors: !!process.env.HTTPS_PROXY
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  check('Seite laedt auf Englisch', await page.title() === 'Owner Radar — TerraMine check-in tracker');

  // GPS -> Minen laden
  await page.click('#btn-locate');
  await page.waitForFunction(() => document.querySelector('#chip-mines').textContent !== '⛏ 0 mines', { timeout: 30000 });
  const minesText = await page.textContent('#chip-mines');
  const groupsText = await page.textContent('#chip-groups');
  check('Minen von der Live-API geladen', /[1-9]/.test(minesText), minesText);
  check('Gruppen gebildet', /[1-9]/.test(groupsText), groupsText);

  await page.waitForSelector('#btn-checkin', { timeout: 10000 });
  const coords1 = await page.textContent('.target-coords b');
  check('Ziel zeigt exakte Koordinaten', /^-?\d+\.\d{5}, -?\d+\.\d{5}$/.test(coords1.trim()), coords1);
  const listLen1 = await page.$$eval('#target-list li', n => n.length);
  check('Weitere Ziele werden gelistet', listLen1 > 1, 'Eintraege: ' + listLen1);
  const routeInfo = await page.textContent('#next-count');
  check('Laufroute mit Gesamtstrecke', /owners · .* round/.test(routeInfo), routeInfo);
  check('Reihenfolge-Umschalter zeigt den Modus', (await page.textContent('#btn-order')) === 'Route');
  await page.screenshot({ path: path.join(OUT, '01-radar.png'), fullPage: true });

  // Check-in mit Ownernamen
  await page.click('#btn-checkin');
  await page.waitForSelector('#sheet-owner');
  await page.fill('#sheet-owner', 'Anna');
  await page.screenshot({ path: path.join(OUT, '02-checkin.png') });
  await page.click('#sheet-save');
  await page.waitForSelector('#sheet-backdrop', { state: 'hidden' });

  const coords2 = await page.textContent('.target-coords b');
  check('Neues Ziel nach dem Check-in', coords2 !== coords1, coords1 + ' -> ' + coords2);
  const streak = await page.textContent('#streak-text');
  check('Streak-Zaehler steht auf 1', /<b>1<\/b>|^1 /.test(streak) || streak.includes('1'), streak);
  const cooldown = await page.textContent('#cooldown-list');
  check('Anna steht im Cooldown', cooldown.includes('Anna'), cooldown.trim().slice(0, 80));

  // Owner-Tab
  await page.click('.tab[data-view="owners"]');
  await page.waitForSelector('#owner-list li');
  const ownerTxt = await page.textContent('#owner-list');
  check('Owner-Liste zeigt Anna mit Restzeit', /Anna/.test(ownerTxt) && /in \d+ h/.test(ownerTxt), ownerTxt.replace(/\s+/g, ' ').slice(0, 120));
  await page.screenshot({ path: path.join(OUT, '03-owner.png'), fullPage: true });

  // Rueckgaengig (Sitzung)
  await page.click('.tab[data-view="radar"]');
  await page.click('#btn-undo');
  await page.waitForTimeout(400);
  const afterUndo = await page.textContent('#cooldown-list');
  check('Rueckgaengig entfernt den Cooldown', !afterUndo.includes('Anna'), afterUndo.trim().slice(0, 80));

  // erneut buchen, damit die Persistenz geprueft werden kann
  await page.click('#btn-checkin');
  await page.waitForSelector('#sheet-owner');
  await page.fill('#sheet-owner', 'Anna');
  await page.click('#sheet-save');
  await page.waitForSelector('#sheet-backdrop', { state: 'hidden' });

  // Persistenz ueber einen Neustart
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#chip-mines').textContent !== '⛏ 0 mines', { timeout: 30000 });
  const cooldown2 = await page.textContent('#cooldown-list');
  check('Cooldown ueberlebt den Neuladen', cooldown2.includes('Anna'), cooldown2.trim().slice(0, 80));
  const coords3 = await page.textContent('.target-coords b');
  check('Vorschlag bleibt bei einem freien Owner', coords3 !== coords1, coords3);

  // Karte
  await page.click('.tab[data-view="map"]');
  await page.waitForSelector('.leaflet-container', { timeout: 20000 });
  await page.waitForTimeout(2500);
  const markers = await page.$$eval('.leaflet-interactive', n => n.length);
  check('Karte zeichnet Minen-Marker', markers > 5, 'Marker: ' + markers);
  await page.screenshot({ path: path.join(OUT, '04-karte.png') });

  // Check-in nachtraeglich loeschen (auch nach einem Neustart moeglich)
  await page.click('.tab[data-view="more"]');
  await page.waitForSelector('#history-list [data-del]');
  page.once('dialog', d => d.accept());
  await page.click('#history-list [data-del]');
  await page.waitForTimeout(400);
  await page.click('.tab[data-view="radar"]');
  const cooldown3 = await page.textContent('#cooldown-list');
  check('geloeschter Check-in gibt den Owner wieder frei', !cooldown3.includes('Anna'), cooldown3.trim().slice(0, 80));

  // Koordinaten mit einem Tipp in die Zwischenablage
  await page.click('.tab[data-view="radar"]');
  const shownCoords = (await page.textContent('.target-coords b')).trim();
  await page.click('#btn-copy-coords');
  await page.waitForTimeout(300);
  const clip = (await page.evaluate(() => navigator.clipboard.readText())).trim();
  check('Ein Tipp kopiert die Koordinaten', clip === shownCoords, `Zwischenablage: "${clip}" / angezeigt: "${shownCoords}"`);
  check('Kopieren wird sichtbar bestaetigt', (await page.textContent('.target-coords .copy-hint')).includes('copied'));

  // Weltweit-Modus mit einem kleinen, stabilen Weltdatensatz
  const WORLD = {
    generatedAt: '2026-08-18T00:00:00.000Z', totalProperties: 3, cellSizeDegrees: 0.02,
    cells: [
      { lat: 40.7040, lng: -73.9940, rock: 20, coal: 6, gold: 2, diamond: 1 },
      { lat: 48.8570, lng: 2.3520, rock: 15, coal: 5, gold: 1, diamond: 0 },
      { lat: 35.6800, lng: 139.7600, rock: 12, coal: 3, gold: 0, diamond: 0 }
    ]
  };
  await page.route('**/getHeatmapData*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(WORLD) }));

  await page.click('#mode-switch .seg[data-mode="world"]');
  await page.waitForSelector('#card-world:not([hidden])');
  check('Weltmodus zeigt die Zufallsort-Karte', await page.isVisible('#btn-dice'));

  await page.click('#btn-dice');
  await page.waitForSelector('#dl-start', { timeout: 10000 });
  check('Weltdaten werden vor dem Laden angekuendigt', (await page.textContent('#sheet-body')).includes('3.6 MB'));
  await page.click('#dl-start');
  await page.waitForSelector('#sheet-backdrop', { state: 'hidden', timeout: 20000 });
  await page.waitForSelector('#world-info:not([hidden])', { timeout: 20000 });

  const spotChip = await page.textContent('#chip-gps');
  check('Zufallsort ist gesetzt', /🎲 -?\d+\.\d{5}/.test(spotChip), spotChip);
  const worldCoords = await page.textContent('.target-coords b');
  check('Zufallsort liefert ein Ziel mit exakten Koordinaten', /^-?\d+\.\d{5}, -?\d+\.\d{5}$/.test(worldCoords.trim()), worldCoords);
  await page.screenshot({ path: path.join(OUT, '05-weltweit.png'), fullPage: true });

  // erneut wuerfeln landet woanders
  const before = await page.textContent('#chip-gps');
  await page.click('#btn-dice');
  await page.waitForFunction(prev => document.querySelector('#chip-gps').textContent !== prev, before, { timeout: 30000 });
  check('Nochmal wuerfeln fuehrt an einen anderen Ort', (await page.textContent('#chip-gps')) !== before);

  // Ort ueberlebt den Wechsel in die Spiel-App (Seite wird neu geladen)
  const spotBefore = await page.textContent('#chip-gps');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#card-world:not([hidden])', { timeout: 15000 });
  check('Zufallsort bleibt nach dem Neuladen erhalten', (await page.textContent('#chip-gps')) === spotBefore,
    spotBefore + ' -> ' + (await page.textContent('#chip-gps')));
  await page.unroute('**/getHeatmapData*');
  await page.click('#mode-switch .seg[data-mode="near"]');
  await page.waitForSelector('#card-near:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#chip-mines').textContent !== '⛏ 0 mines', { timeout: 30000 });

  // Leerer Umkreis: verstaendliche Meldung statt Blindflug (API-Antwort simuliert)
  await page.route('**/getPropertiesInViewport*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"properties":[],"truncated":false}' }));
  await page.click('#btn-refresh');
  await page.waitForFunction(() => document.querySelector('#chip-mines').textContent === '⛏ 0 mines', { timeout: 15000 });
  const emptyText = await page.textContent('#target-slot');
  check('leerer Umkreis wird erklaert', /No mines nearby/.test(emptyText), emptyText.replace(/\s+/g, ' ').slice(0, 90));
  await page.unroute('**/getPropertiesInViewport*');

  // Sprache umschalten
  const enTabs = await page.textContent('.tabbar');
  check('Oberflaeche startet auf Englisch', enTabs.includes('Owners') && enTabs.includes('More'), enTabs.replace(/\s+/g, ' '));
  await page.click('#btn-lang');
  await page.waitForTimeout(400);
  const deTabs = await page.textContent('.tabbar');
  check('Umschalten auf Deutsch aendert die Oberflaeche', deTabs.includes('Owner') && deTabs.includes('Mehr'), deTabs.replace(/\s+/g, ' '));
  check('Kopfzeile bietet danach Englisch an', (await page.textContent('#btn-lang')) === 'EN');
  const deChip = await page.textContent('#chip-mines');
  check('auch dynamische Texte wechseln', /Minen/.test(deChip), deChip);
  const deMode = await page.textContent('#mode-switch');
  check('Modusumschalter ist uebersetzt', deMode.includes('Umkreis') && deMode.includes('Weltweit'), deMode.replace(/\s+/g, ' '));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  check('Sprachwahl ueberlebt den Neustart', (await page.textContent('.tabbar')).includes('Mehr'));

  // zurueck auf Englisch (Hauptsprache)
  await page.click('#btn-lang');
  await page.waitForTimeout(300);
  check('Zurueckschalten auf Englisch klappt', (await page.textContent('.tabbar')).includes('More'));

  check('keine JS-Fehler', errors.length === 0, errors.join(' | '));

  await browser.close();
  server.close();

  const failed = checks.filter(c => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} Pruefungen bestanden · Screenshots: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
