/* Tests fuer die Kern-Logik: node --test tests/run.js  (bzw. npm test) */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const util = require(path.join(__dirname, '../assets/js/util.js'));
const cluster = require(path.join(__dirname, '../assets/js/cluster.js'));
const storeMod = require(path.join(__dirname, '../assets/js/store.js'));

const HOUR = 3600000;
const T0 = Date.UTC(2026, 7, 18, 12, 0, 0);

function memStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k)
  };
}

/* Baut ein Raster aus n x n Minen im 0.0001-Grad-Gitter des Spiels. */
function block(lat, lng, n, type = 'rock') {
  const out = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const la = +(lat + i * 0.0001).toFixed(5);
      const ln = +(lng + j * 0.0001).toFixed(5);
      out.push({ id: util.mineId(la, ln), lat: la, lng: ln, type });
    }
  }
  return out;
}

function fresh() {
  const s = storeMod.createStore(memStorage());
  s.setSettings({ radiusM: 2000, cooldownH: 24, linkM: 25 });
  return s;
}

// ── util ────────────────────────────────────────────────────────────────────
test('distance: bekannte Strecke', () => {
  const d = util.distance(40.70355, -73.99375, 40.70455, -73.99375); // 0.001 Grad Nord
  assert.ok(Math.abs(d - 111.2) < 1.5, `erwartet ~111 m, war ${d}`);
});

test('distance: eine Rasterzelle ist ~11 m', () => {
  const d = util.distance(40.70355, -73.99375, 40.70365, -73.99375);
  assert.ok(d > 10 && d < 12, `war ${d}`);
});

test('bbox deckt den Radius ab und ist nicht zu gross', () => {
  const b = util.bboxFromRadius(52.52, 13.405, 800);
  assert.ok(util.distance(52.52, 13.405, b.maxLat, 13.405) > 795);
  assert.ok(util.distance(52.52, 13.405, 52.52, b.maxLng) > 795);
  assert.ok(util.distance(52.52, 13.405, b.maxLat, b.maxLng) < 1250);
});

test('mineId ist stabil und rundet auf das Spielraster', () => {
  assert.equal(util.mineId(40.703550000000004, -73.99375), '40.70355,-73.99375');
  assert.deepEqual(util.parseMineId('40.70355,-73.99375'), { lat: 40.70355, lng: -73.99375 });
});

test('parseLatLng akzeptiert gaengige Schreibweisen', () => {
  assert.deepEqual(util.parseLatLng('40.70355, -73.99375'), { lat: 40.70355, lng: -73.99375 });
  assert.deepEqual(util.parseLatLng('  52.52 13.405 '), { lat: 52.52, lng: 13.405 });
  assert.equal(util.parseLatLng('kein koordinatenpaar'), null);
  assert.equal(util.parseLatLng('95.0, 10.0'), null);
});

test('fmtDuration rundet auf und bleibt lesbar', () => {
  assert.equal(util.fmtDuration(0), 'now');
  assert.equal(util.fmtDuration(30 * 60000), '30 min');
  assert.equal(util.fmtDuration(7.2 * HOUR), '7 h 12 min');
  assert.equal(util.fmtDuration(24 * HOUR), '24 h');
});

test('compass zeigt in die richtige Richtung', () => {
  assert.equal(util.compass(util.bearing(52.52, 13.405, 52.53, 13.405)), 'N');
  assert.equal(util.compass(util.bearing(52.52, 13.405, 52.52, 13.42)), 'E');
});

// ── cluster ─────────────────────────────────────────────────────────────────
test('getrennte Bloecke werden getrennte Gruppen', () => {
  const mines = block(52.5200, 13.4050, 3).concat(block(52.5250, 13.4100, 2));
  const gs = cluster.clusterMines(mines, 25);
  assert.equal(gs.length, 2);
  assert.deepEqual(gs.map(g => g.size), [9, 4]);
});

test('Cluster-ID bleibt gleich, egal in welcher Reihenfolge die Minen kommen', () => {
  const mines = block(52.52, 13.405, 3);
  const a = cluster.clusterMines(mines, 25)[0].id;
  const b = cluster.clusterMines(mines.slice().reverse(), 25)[0].id;
  assert.equal(a, b);
});

test('Cluster-ID bleibt gleich, wenn am Rand eine Mine dazukommt', () => {
  const base = block(52.52, 13.405, 3);
  const a = cluster.clusterMines(base, 25)[0].id;
  const extra = base.concat([{ id: util.mineId(52.5203, 13.4051), lat: 52.5203, lng: 13.4051, type: 'gold' }]);
  const b = cluster.clusterMines(extra, 25)[0].id;
  assert.equal(a, b);
});

test('grosse Distanz verbindet, kleine trennt', () => {
  const mines = [
    { id: 'a', lat: 52.5200, lng: 13.4050, type: 'rock' },
    { id: 'b', lat: 52.5203, lng: 13.4050, type: 'rock' }   // ~33 m
  ];
  assert.equal(cluster.clusterMines(mines, 25).length, 2);
  assert.equal(cluster.clusterMines(mines, 40).length, 1);
});

test('Cluster zaehlt Typen und findet den wertvollsten', () => {
  const mines = block(52.52, 13.405, 2).concat([
    { id: util.mineId(52.52, 13.4052), lat: 52.52, lng: 13.4052, type: 'diamond' }
  ]);
  const g = cluster.clusterMines(mines, 25)[0];
  assert.equal(g.counts.rock, 4);
  assert.equal(g.counts.diamond, 1);
  assert.equal(cluster.bestType(g.counts), 'diamond');
});

// ── store: Cooldown-Grundlogik ──────────────────────────────────────────────
test('Check-in sperrt die ganze Gruppe fuer 24 h und gibt sie danach wieder frei', () => {
  const s = fresh();
  const groups = cluster.clusterMines(block(52.52, 13.405, 3), 25);
  const me = { lat: 52.5195, lng: 13.4045 };

  let targets = s.selectTargets(groups, me, T0);
  assert.equal(targets.length, 1);

  s.checkIn({ group: groups[0], mine: targets[0].mine }, T0);
  assert.equal(s.selectTargets(groups, me, T0 + HOUR).length, 0, 'direkt danach gesperrt');
  assert.equal(s.selectTargets(groups, me, T0 + 23.5 * HOUR).length, 0, 'kurz vor Ablauf noch gesperrt');
  assert.equal(s.selectTargets(groups, me, T0 + 24 * HOUR + 1000).length, 1, 'nach 24 h wieder frei');
});

test('gesperrte Gruppe meldet die Restzeit', () => {
  const s = fresh();
  const groups = cluster.clusterMines(block(52.52, 13.405, 2), 25);
  s.checkIn({ group: groups[0], mine: groups[0].mines[0] }, T0);
  const st = s.groupStatus(groups[0], T0 + 2 * HOUR);
  assert.equal(st.state, 'cooldown');
  assert.equal(st.until, T0 + 24 * HOUR);
});

test('eigene Cooldown-Dauer wird beachtet', () => {
  const s = fresh();
  s.setSettings({ cooldownH: 12 });
  const groups = cluster.clusterMines(block(52.52, 13.405, 2), 25);
  s.checkIn({ group: groups[0], mine: groups[0].mines[0] }, T0);
  assert.equal(s.selectTargets(groups, { lat: 52.52, lng: 13.404 }, T0 + 11 * HOUR).length, 0);
  assert.equal(s.selectTargets(groups, { lat: 52.52, lng: 13.404 }, T0 + 13 * HOUR).length, 1);
});

test('nur der abgehakte Owner ist gesperrt, andere bleiben verfuegbar', () => {
  const s = fresh();
  const mines = block(52.5200, 13.4050, 2).concat(block(52.5230, 13.4090, 2));
  const groups = cluster.clusterMines(mines, 25);
  const me = { lat: 52.5210, lng: 13.4070 };
  assert.equal(s.selectTargets(groups, me, T0).length, 2);

  const first = s.selectTargets(groups, me, T0)[0];
  s.checkIn({ group: first.group, mine: first.mine }, T0);

  const rest = s.selectTargets(groups, me, T0 + HOUR);
  assert.equal(rest.length, 1);
  assert.notEqual(rest[0].group.id, first.group.id);
});

// ── store: benannte Owner ───────────────────────────────────────────────────
test('gleicher Ownername in zwei Clustern sperrt beide', () => {
  const s = fresh();
  const groups = cluster.clusterMines(block(52.5200, 13.4050, 2).concat(block(52.5230, 13.4090, 2)), 25);
  const me = { lat: 52.5210, lng: 13.4070 };

  s.checkIn({ group: groups[0], mine: groups[0].mines[0], ownerName: 'Anna' }, T0);
  // Zweiten Cluster derselben Person zuordnen (ohne Check-in) …
  const t2 = s.selectTargets(groups, me, T0 + HOUR)[0];
  assert.ok(t2, 'zweiter Cluster ist noch frei');
  s.checkIn({ group: t2.group, mine: t2.mine, ownerName: 'Anna' }, T0 + HOUR);

  assert.equal(Object.keys(s.owners()).length, 1, 'nur ein Owner-Eintrag fuer Anna');
  assert.equal(s.selectTargets(groups, me, T0 + 2 * HOUR).length, 0, 'beide Cluster gesperrt');
});

test('Ownername ist unabhaengig von Gross-/Kleinschreibung', () => {
  const s = fresh();
  const groups = cluster.clusterMines(block(52.5200, 13.4050, 2).concat(block(52.5230, 13.4090, 2)), 25);
  s.checkIn({ group: groups[0], mine: groups[0].mines[0], ownerName: 'Max Mustermann' }, T0);
  s.checkIn({ group: groups[1], mine: groups[1].mines[0], ownerName: '  max mustermann ' }, T0 + HOUR);
  assert.equal(Object.keys(s.owners()).length, 1);
});

test('anonymer Owner wird beim Nachtragen des Namens umbenannt, nicht dupliziert', () => {
  const s = fresh();
  const groups = cluster.clusterMines(block(52.52, 13.405, 2), 25);
  s.checkIn({ group: groups[0], mine: groups[0].mines[0] }, T0);
  const key = Object.keys(s.owners())[0];
  assert.equal(s.owner(key).anon, true);

  s.renameOwner(key, 'Anna');
  assert.equal(Object.keys(s.owners()).length, 1);
  assert.equal(s.owner(key).name, 'Anna');
  assert.equal(s.owner(key).anon, false);
  assert.equal(s.owner(key).lastCheckInAt, T0, 'Cooldown bleibt beim Umbenennen erhalten');
});

test('Umbenennen auf einen vorhandenen Namen fuehrt beide zusammen und behaelt den juengsten Check-in', () => {
  const s = fresh();
  const groups = cluster.clusterMines(block(52.5200, 13.4050, 2).concat(block(52.5230, 13.4090, 2)), 25);
  s.checkIn({ group: groups[0], mine: groups[0].mines[0], ownerName: 'Anna' }, T0);
  s.checkIn({ group: groups[1], mine: groups[1].mines[0] }, T0 + 2 * HOUR);
  const anonKey = Object.keys(s.owners()).find(k => s.owner(k).anon);

  s.renameOwner(anonKey, 'Anna');
  const keys = Object.keys(s.owners());
  assert.equal(keys.length, 1);
  assert.equal(s.owner(keys[0]).lastCheckInAt, T0 + 2 * HOUR);
  assert.equal(s.owner(keys[0]).count, 2);
});

// ── store: Auswahl-Regeln ───────────────────────────────────────────────────
test('kein Owner erscheint zweimal in der Zielliste', () => {
  const s = fresh();
  const groups = cluster.clusterMines(block(52.5200, 13.4050, 2).concat(block(52.5230, 13.4090, 2)), 25);
  s.checkIn({ group: groups[0], mine: groups[0].mines[0], ownerName: 'Anna' }, T0 - 48 * HOUR);
  s.checkIn({ group: groups[1], mine: groups[1].mines[0], ownerName: 'Anna' }, T0 - 47 * HOUR);
  const targets = s.selectTargets(groups, { lat: 52.521, lng: 13.407 }, T0);
  assert.equal(targets.length, 1, 'beide Cluster gehoeren Anna -> nur ein Vorschlag');
});

test('Ziele sind nach Laufweg sortiert', () => {
  const s = fresh();
  s.setSettings({ preferRare: false });
  const groups = cluster.clusterMines(
    block(52.5200, 13.4050, 2).concat(block(52.5260, 13.4050, 2)).concat(block(52.5230, 13.4050, 2)), 25);
  const t = s.selectTargets(groups, { lat: 52.5195, lng: 13.4050 }, T0);
  assert.equal(t.length, 3);
  assert.ok(t[0].distance < t[1].distance && t[1].distance < t[2].distance);
});

test('seltene Minen bekommen Vorrang, wenn der Umweg klein ist', () => {
  const s = fresh();
  const mines = block(52.5200, 13.4050, 2, 'rock').concat(block(52.5202, 13.4060, 2, 'diamond'));
  const groups = cluster.clusterMines(mines, 25);
  const me = { lat: 52.5195, lng: 13.4050 };
  s.setSettings({ preferRare: false });
  assert.equal(cluster.bestType(s.selectTargets(groups, me, T0)[0].group.counts), 'rock');
  s.setSettings({ preferRare: true });
  assert.equal(s.selectTargets(groups, me, T0)[0].mine.type, 'diamond');
});

test('Typfilter blendet Gruppen ohne passenden Typ aus', () => {
  const s = fresh();
  const groups = cluster.clusterMines(block(52.5200, 13.4050, 2, 'rock').concat(block(52.5230, 13.4090, 2, 'gold')), 25);
  s.setSettings({ types: { rock: false, coal: false, gold: true, diamond: true } });
  const t = s.selectTargets(groups, { lat: 52.521, lng: 13.407 }, T0);
  assert.equal(t.length, 1);
  assert.equal(t[0].mine.type, 'gold');
});

test('gesperrte Mine wird uebersprungen, die Gruppe bleibt nutzbar', () => {
  const s = fresh();
  const groups = cluster.clusterMines(block(52.52, 13.405, 2), 25);
  const nearest = s.selectTargets(groups, { lat: 52.5195, lng: 13.4045 }, T0)[0].mine;
  s.blockMine(nearest.id, 0, nearest.type);

  const t = s.selectTargets(groups, { lat: 52.5195, lng: 13.4045 }, T0);
  assert.equal(t.length, 1);
  assert.notEqual(t[0].mine.id, nearest.id, 'die gesperrte Mine wird nicht mehr vorgeschlagen');

  s.unblockMine(nearest.id);
  assert.equal(s.selectTargets(groups, { lat: 52.5195, lng: 13.4045 }, T0)[0].mine.id, nearest.id);
});

test('Ueberspringen legt die Gruppe nur zeitweise still', () => {
  const s = fresh();
  const groups = cluster.clusterMines(block(52.52, 13.405, 2), 25);
  s.snoozeGroup(groups[0].id, 3);
  const now = Date.now();
  assert.equal(s.selectTargets(groups, { lat: 52.52, lng: 13.404 }, now).length, 0);
  assert.equal(s.groupStatus(groups[0], now).state, 'snoozed');
  assert.equal(s.selectTargets(groups, { lat: 52.52, lng: 13.404 }, now + 4 * HOUR).length, 1);
});

// ── store: Mehr-Owner-Bloecke ───────────────────────────────────────────────
test('im Mehr-Owner-Block sperrt ein Check-in nur die Umgebung', () => {
  const s = fresh();
  // Langer Riegel: eine Reihe von 12 Feldern (~130 m), alle verbunden.
  const mines = [];
  for (let j = 0; j < 12; j++) {
    const ln = +(13.4050 + j * 0.0001).toFixed(5);
    mines.push({ id: util.mineId(52.52, ln), lat: 52.52, lng: ln, type: 'rock' });
  }
  const groups = cluster.clusterMines(mines, 25);
  assert.equal(groups.length, 1);
  s.setMultiOwner(groups[0].id, true);
  s.checkIn({ group: groups[0], mine: mines[0] }, T0);

  const st = s.groupStatus(groups[0], T0 + HOUR);
  assert.equal(st.state, 'free', 'der Rest des Blocks bleibt nutzbar');
  const freeIds = st.freeMines.map(m => m.id);
  assert.ok(!freeIds.includes(mines[0].id), 'die abgehakte Mine ist gesperrt');
  assert.ok(!freeIds.includes(mines[1].id), 'direkte Nachbarn ebenfalls');
  assert.ok(freeIds.includes(mines[11].id), 'weit entfernte Felder im selben Block nicht');
});

test('ohne Mehr-Owner-Markierung sperrt ein Check-in den ganzen Block', () => {
  const s = fresh();
  const mines = [];
  for (let j = 0; j < 12; j++) {
    const ln = +(13.4050 + j * 0.0001).toFixed(5);
    mines.push({ id: util.mineId(52.52, ln), lat: 52.52, lng: ln, type: 'rock' });
  }
  const groups = cluster.clusterMines(mines, 25);
  s.checkIn({ group: groups[0], mine: mines[0] }, T0);
  assert.equal(s.groupStatus(groups[0], T0 + HOUR).state, 'cooldown');
});

// ── store: Statistik, Undo, Import/Export ───────────────────────────────────
test('Tages-Statistik zaehlt verschiedene Owner fuer den Streak-Bonus', () => {
  const s = fresh();
  const now = Date.now();
  const groups = cluster.clusterMines(
    block(52.5200, 13.4050, 2).concat(block(52.5230, 13.4090, 2)).concat(block(52.5260, 13.4130, 2)), 25);
  groups.forEach((g, i) => s.checkIn({ group: g, mine: g.mines[0], ownerName: 'P' + i }, now - i * 60000));
  const st = s.stats(now);
  assert.equal(st.todayOwners, 3);
  assert.equal(st.nextMilestone.need, 5);
  assert.equal(st.ownersOnCooldown, 3);
});

test('Undo macht einen versehentlichen Check-in rueckgaengig', () => {
  const s = fresh();
  const groups = cluster.clusterMines(block(52.52, 13.405, 2), 25);
  s.checkIn({ group: groups[0], mine: groups[0].mines[0], ownerName: 'Anna' }, T0);
  assert.equal(s.selectTargets(groups, { lat: 52.52, lng: 13.404 }, T0).length, 0);

  assert.ok(s.canUndo());
  s.undo();
  assert.equal(Object.keys(s.owners()).length, 0);
  assert.equal(s.selectTargets(groups, { lat: 52.52, lng: 13.404 }, T0).length, 1);
});

test('Export/Import stellt den Stand vollstaendig wieder her', () => {
  const s = fresh();
  const groups = cluster.clusterMines(block(52.52, 13.405, 2), 25);
  s.checkIn({ group: groups[0], mine: groups[0].mines[0], ownerName: 'Anna' }, T0);
  const dump = s.exportJson();

  const s2 = storeMod.createStore(memStorage());
  s2.importJson(dump, 'replace');
  assert.equal(Object.keys(s2.owners()).length, 1);
  assert.equal(s2.findOwnerByName('Anna').lastCheckInAt, T0);
  assert.equal(s2.selectTargets(groups, { lat: 52.52, lng: 13.404 }, T0 + HOUR).length, 0);
});

test('Import im Misch-Modus fuehrt gleiche Owner zusammen', () => {
  const groups = cluster.clusterMines(block(52.5200, 13.4050, 2).concat(block(52.5230, 13.4090, 2)), 25);
  const a = fresh();
  a.checkIn({ group: groups[0], mine: groups[0].mines[0], ownerName: 'Anna' }, T0);
  const b = fresh();
  b.checkIn({ group: groups[1], mine: groups[1].mines[0], ownerName: 'Anna' }, T0 + 3 * HOUR);

  a.importJson(b.exportJson(), 'merge');
  assert.equal(Object.keys(a.owners()).length, 1);
  assert.equal(a.findOwnerByName('Anna').lastCheckInAt, T0 + 3 * HOUR);
  assert.equal(a.stats(T0 + 4 * HOUR).totalCheckIns, 2);
});

test('Daten ueberleben einen Neustart des Browsers', () => {
  const storage = memStorage();
  const s1 = storeMod.createStore(storage);
  const groups = cluster.clusterMines(block(52.52, 13.405, 2), 25);
  s1.checkIn({ group: groups[0], mine: groups[0].mines[0], ownerName: 'Anna' }, T0);

  const s2 = storeMod.createStore(storage);
  assert.equal(s2.findOwnerByName('Anna').lastCheckInAt, T0);
  assert.equal(s2.selectTargets(groups, { lat: 52.52, lng: 13.404 }, T0 + HOUR).length, 0);
});

test('kaputter Speicherinhalt setzt sauber zurueck statt zu crashen', () => {
  const storage = memStorage();
  storage.setItem(storeMod.STORAGE_KEY, '{kein json');
  const s = storeMod.createStore(storage);
  assert.deepEqual(s.owners(), {});
  assert.equal(s.settings().cooldownH, 24);
});

test('Cooldown-Reset gibt einen Owner sofort wieder frei', () => {
  const s = fresh();
  const groups = cluster.clusterMines(block(52.52, 13.405, 2), 25);
  s.checkIn({ group: groups[0], mine: groups[0].mines[0], ownerName: 'Anna' }, T0);
  s.resetOwnerCooldown(s.findOwnerByName('Anna').key);
  assert.equal(s.selectTargets(groups, { lat: 52.52, lng: 13.404 }, T0 + HOUR).length, 1);
});

test('fmtDuration zeigt einen 24-h-Cooldown in Stunden statt Tagen', () => {
  assert.equal(util.fmtDuration(24 * HOUR), '24 h');
  assert.equal(util.fmtDuration(47 * HOUR), '47 h');
  assert.equal(util.fmtDuration(50 * HOUR), '2 d 2 h');
});

test('einzelner Check-in laesst sich nachtraeglich loeschen', () => {
  const s = fresh();
  const groups = cluster.clusterMines(block(52.52, 13.405, 2), 25);
  s.checkIn({ group: groups[0], mine: groups[0].mines[0], ownerName: 'Anna' }, T0);
  assert.equal(s.selectTargets(groups, { lat: 52.52, lng: 13.404 }, T0 + HOUR).length, 0);

  s.deleteCheckIn(0);
  assert.equal(s.findOwnerByName('Anna').lastCheckInAt, 0);
  assert.equal(s.findOwnerByName('Anna').count, 0);
  assert.equal(s.selectTargets(groups, { lat: 52.52, lng: 13.404 }, T0 + HOUR).length, 1, 'Gruppe ist wieder frei');
  assert.equal(s.stats(T0 + HOUR).totalCheckIns, 0);
});

test('beim Loeschen zaehlt der naechstjuengere Check-in desselben Owners', () => {
  const s = fresh();
  const groups = cluster.clusterMines(block(52.5200, 13.4050, 2).concat(block(52.5230, 13.4090, 2)), 25);
  s.checkIn({ group: groups[0], mine: groups[0].mines[0], ownerName: 'Anna' }, T0 - 30 * HOUR);
  s.checkIn({ group: groups[1], mine: groups[1].mines[0], ownerName: 'Anna' }, T0);
  s.deleteCheckIn(0);                                   // den juengsten entfernen
  assert.equal(s.findOwnerByName('Anna').lastCheckInAt, T0 - 30 * HOUR);
  assert.equal(s.selectTargets(groups, { lat: 52.521, lng: 13.407 }, T0).length, 1, 'Cooldown ist damit abgelaufen');
});

test('Laufroute kettet die Ziele vom Startpunkt aus', () => {
  const s = fresh();
  // drei Cluster: nah / mittel / weit — bewusst unsortiert uebergeben
  const groups = cluster.clusterMines(
    block(52.5290, 13.4050, 2).concat(block(52.5210, 13.4050, 2)).concat(block(52.5250, 13.4050, 2)), 25);
  const me = { lat: 52.5200, lng: 13.4050 };
  const targets = s.selectTargets(groups, me, T0);
  const route = s.routeTargets(targets, me);

  assert.equal(route.length, 3);
  assert.ok(route[0].mine.lat < route[1].mine.lat && route[1].mine.lat < route[2].mine.lat, 'von Sued nach Nord abgelaufen');
  assert.ok(route[0].totalDistance < route[1].totalDistance && route[1].totalDistance < route[2].totalDistance);
  const sumLegs = route.reduce((a, r) => a + r.legDistance, 0);
  assert.ok(Math.abs(sumLegs - route[2].totalDistance) < 0.5, 'Etappen summieren sich zur Gesamtstrecke');
});

test('Laufroute ist kuerzer als die Reihenfolge nach Luftlinie, wenn ein Umweg droht', () => {
  const s = fresh();
  const me = { lat: 52.5200, lng: 13.4050 };
  const groups = cluster.clusterMines(
    block(52.5203, 13.4050, 1).concat(block(52.5215, 13.4050, 1)).concat(block(52.5204, 13.4090, 1)), 25);
  const targets = s.selectTargets(groups, me, T0);
  const route = s.routeTargets(targets, me);
  const naive = targets.reduce((acc, t, i) => {
    const prev = i === 0 ? me : targets[i - 1].mine;
    return acc + util.distance(prev.lat, prev.lng, t.mine.lat, t.mine.lng);
  }, 0);
  assert.ok(route[route.length - 1].totalDistance <= naive + 0.001, 'Route ist nie laenger als die naive Reihenfolge');
});

test('fmtDist rundet und nutzt englische Schreibweise als Standard', () => {
  assert.equal(util.fmtDist(28.4), '28 m');
  assert.equal(util.fmtDist(999), '999 m');
  assert.equal(util.fmtDist(2913), '2.91 km');
  assert.equal(util.fmtDist(24500), '24.5 km');
});

test('Typfilter einzeln umschalten verliert die anderen Typen nicht', () => {
  const s = fresh();
  s.setSettings({ types: { rock: false } });
  s.setSettings({ types: { coal: false } });
  const t = s.settings().types;
  assert.deepEqual(t, { rock: false, coal: false, gold: true, diamond: true });

  const groups = cluster.clusterMines(
    block(52.5200, 13.4050, 2, 'rock').concat(block(52.5230, 13.4090, 2, 'coal')).concat(block(52.5260, 13.4130, 2, 'gold')), 25);
  const targets = s.selectTargets(groups, { lat: 52.521, lng: 13.407 }, T0);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].mine.type, 'gold');
});

test('unvollstaendige gespeicherte Einstellungen werden mit Standardwerten aufgefuellt', () => {
  const storage = memStorage();
  storage.setItem(storeMod.STORAGE_KEY, JSON.stringify({ v: 1, settings: { radiusM: 1500 }, owners: {}, mines: {} }));
  const s = storeMod.createStore(storage);
  assert.equal(s.settings().radiusM, 1500, 'eigener Wert bleibt');
  assert.equal(s.settings().cooldownH, 24, 'fehlender Wert kommt aus den Standards');
  assert.equal(s.settings().linkM, 25);
  assert.deepEqual(s.settings().types, { rock: true, coal: true, gold: true, diamond: true });
  assert.equal(s.settings().routeOrder, true);
});

test('Import legt keinen Owner auf einen belegten Schluessel', () => {
  const groups = cluster.clusterMines(block(52.5200, 13.4050, 2).concat(block(52.5230, 13.4090, 2)), 25);
  const a = fresh();
  a.checkIn({ group: groups[0], mine: groups[0].mines[0], ownerName: 'Anna' }, T0);
  a.raw().seq = 0;                                    // Zaehler kuenstlich zuruecksetzen

  const b = fresh();
  b.checkIn({ group: groups[1], mine: groups[1].mines[0], ownerName: 'Bob' }, T0 + HOUR);
  a.importJson(b.exportJson(), 'merge');

  const names = Object.keys(a.owners()).map(k => a.owner(k).name).sort();
  assert.deepEqual(names, ['Anna', 'Bob'], 'beide Owner bleiben erhalten');
});

// ── Zufallsorte weltweit ────────────────────────────────────────────────────
const world = require(path.join(__dirname, '../assets/js/world.js'));

function worldCells() {
  return [
    { lat: 52.520, lng: 13.405, rock: 30, coal: 10, gold: 3, diamond: 1 },  // gross, mit Diamant
    { lat: 40.700, lng: -74.000, rock: 12, coal: 4, gold: 2, diamond: 0 },  // gross, mit Gold
    { lat: -33.870, lng: 151.210, rock: 2, coal: 0, gold: 0, diamond: 0 },  // winzig
    { lat: 35.680, lng: 139.760, rock: 8, coal: 1, gold: 0, diamond: 0 }    // mittel, ohne Gold
  ];
}

test('Weltmodus filtert Zellen nach Groesse und Minentyp', () => {
  const cells = worldCells();
  assert.equal(world.filterCells(cells, { minMines: 1 }).length, 4);
  assert.equal(world.filterCells(cells, { minMines: 10 }).length, 2);
  assert.equal(world.filterCells(cells, { minMines: 1, requireType: 'diamond' }).length, 1);
  assert.equal(world.filterCells(cells, { minMines: 1, requireType: 'gold' }).length, 2);
  assert.equal(world.cellTotal(cells[0]), 44);
});

test('Zufallsziehung beachtet Filter und besuchte Orte', () => {
  const cells = worldCells();
  const exclude = {};
  exclude[world.cellKey(cells[0])] = true;
  const pick = world.pickCell(cells, { minMines: 10, requireType: 'any', exclude }, () => 0);
  assert.equal(world.cellKey(pick.cell), world.cellKey(cells[1]));
  assert.equal(pick.relaxed, false);
});

test('Zufallsziehung lockert die Filter, statt leer auszugehen', () => {
  const cells = worldCells();
  const exclude = {};
  cells.forEach(c => { exclude[world.cellKey(c)] = true; });      // alles schon besucht
  const pick = world.pickCell(cells, { minMines: 999, requireType: 'diamond', exclude }, () => 0);
  assert.ok(pick, 'es kommt trotzdem ein Ort zurueck');
  assert.equal(pick.relaxed, true);
});

test('Zufallsziehung streut ueber die ganze Welt', () => {
  const cells = worldCells();
  const seen = new Set();
  let seed = 0;
  const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 200; i++) seen.add(world.cellKey(world.pickCell(cells, { minMines: 1 }, rng).cell));
  assert.equal(seen.size, 4, 'alle Zellen kommen vor');
});

test('Zellfenster umschliesst die Zelle mit etwas Rand', () => {
  const b = world.cellBbox({ lat: 52.52, lng: 13.405 }, 0.02, 0.004);
  assert.ok(Math.abs((b.maxLat - b.minLat) - 0.028) < 1e-9);
  assert.ok(b.minLat < 52.51 && b.maxLat > 52.53);
});

test('besuchte Zufallsorte werden gemerkt und begrenzt', () => {
  const s = fresh();
  s.markCellVisited('52.520,13.405', T0);
  s.markCellVisited('40.700,-74.000', T0 + 1000);
  assert.deepEqual(Object.keys(s.visitedCells()).sort(), ['40.700,-74.000', '52.520,13.405']);

  for (let i = 0; i < 500; i++) s.markCellVisited('c' + i, T0 + 2000 + i);
  assert.ok(Object.keys(s.visitedCells()).length <= 400, 'aeltere Eintraege fallen raus');
  assert.ok(!s.visitedCells()['52.520,13.405'], 'der aelteste ist weg');

  s.clearVisitedCells();
  assert.deepEqual(s.visitedCells(), {});
});

test('Weltmodus-Einstellungen ueberleben einen Neustart', () => {
  const storage = memStorage();
  const s1 = storeMod.createStore(storage);
  s1.setSettings({ mode: 'world', worldMinMines: 25, worldRequireType: 'diamond' });
  const s2 = storeMod.createStore(storage);
  assert.equal(s2.settings().mode, 'world');
  assert.equal(s2.settings().worldMinMines, 25);
  assert.equal(s2.settings().worldRequireType, 'diamond');
});

// ── Sprachen ────────────────────────────────────────────────────────────────
const i18n = require(path.join(__dirname, '../assets/js/i18n.js'));
const fs = require('fs');

test('Englisch ist die Standardsprache', () => {
  assert.equal(i18n.DEFAULT, 'en');
  assert.equal(i18n.lang(), 'en');
  assert.equal(i18n.t('nav.owners'), 'Owners');
});

test('beide Sprachen haben genau dieselben Schluessel', () => {
  const en = Object.keys(i18n.STRINGS.en).sort();
  const de = Object.keys(i18n.STRINGS.de).sort();
  assert.deepEqual(en, de);
  assert.ok(en.length > 200, `nur ${en.length} Schluessel`);
});

test('keine Uebersetzung ist leer oder unveraendert kopiert', () => {
  // In beiden Sprachen bewusst identisch (Eigennamen, Symbole, gleiche Woerter).
  const same = new Set(['nav.radar', 'chip.gps', 'loc.gps', 'loc.placeholder', 'world.typeGold',
    'list.orderRoute', 'owners.in', 'owners.rename', 'settings.gold', 'settings.export',
    'settings.import', 'settings.cooldownSet', 'map.popupRoute', 'toast.copied']);
  for (const key of Object.keys(i18n.STRINGS.en)) {
    assert.ok(i18n.STRINGS.en[key].trim(), `EN leer: ${key}`);
    assert.ok(i18n.STRINGS.de[key].trim(), `DE leer: ${key}`);
    if (!same.has(key)) {
      assert.notEqual(i18n.STRINGS.de[key], i18n.STRINGS.en[key], `DE nicht uebersetzt: ${key}`);
    }
  }
});

test('Platzhalter stimmen in beiden Sprachen ueberein', () => {
  const ph = s => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const key of Object.keys(i18n.STRINGS.en)) {
    assert.equal(ph(i18n.STRINGS.de[key]), ph(i18n.STRINGS.en[key]), `Platzhalter weichen ab: ${key}`);
  }
});

test('jeder im Code benutzte Schluessel existiert im Woerterbuch', () => {
  const appSrc = fs.readFileSync(path.join(__dirname, '../assets/js/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const used = new Set();
  for (const m of appSrc.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n(?:-html|-ph|-title)?="([a-zA-Z0-9_.]+)"/g)) used.add(m[1]);
  assert.ok(used.size > 80, `nur ${used.size} Schluessel im Code gefunden`);
  const missing = [...used].filter(k => !(k in i18n.STRINGS.en));
  assert.deepEqual(missing, [], 'unbekannte Schluessel: ' + missing.join(', '));
});

test('Umschalten wirkt auf Texte und Formate', () => {
  i18n.setLang('de');
  assert.equal(i18n.t('nav.owners'), 'Owner');
  assert.equal(util.fmtDist(2913), '2,91 km');
  assert.equal(util.compass(90), 'O');
  i18n.setLang('en');
  assert.equal(i18n.t('nav.owners'), 'Owners');
  assert.equal(util.fmtDist(2913), '2.91 km');
  assert.equal(util.compass(90), 'E');
});

test('Platzhalter werden ersetzt, unbekannte Schluessel bleiben sichtbar', () => {
  assert.equal(i18n.t('list.fields', { n: 7 }), '7 tiles');
  assert.equal(i18n.t('cooldown.freeIn', { t: '3 h' }), 'free in 3 h');
  assert.equal(i18n.t('gibt.es.nicht'), 'gibt.es.nicht');
});

test('das Markup enthaelt keinen fest verdrahteten deutschen Text', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  const german = html.match(/>[^<>{}]*\b(Owner-Name|Minen|Zufallsort|Koordinaten|Einstellungen|Karte|Standort)\b[^<>]*</g) || [];
  assert.deepEqual(german, [], 'deutscher Text im Markup: ' + german.join(' | '));
});
