/* Zustand des Trackers: Owner, Cooldowns, Check-ins, Einstellungen.

   Alles liegt lokal im Browser (localStorage) — kein Server, kein Account.
   Die Logik ist bewusst von der UI getrennt und wird in tests/run.js geprueft. */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var api = factory(isNode ? require('./util.js') : root.TM.util);
  if (isNode) module.exports = api;
  root.TM = Object.assign(root.TM || {}, { store: api });
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util) {
  'use strict';

  var STORAGE_KEY = 'terramine-owner-radar:v1';
  var FOREVER = 8.64e15;                 // "dauerhaft gesperrt" (max. JS-Datum)
  var MULTI_OWNER_RADIUS_M = 30;         // in gemischten Bloecken sperrt ein Check-in nur die naehere Umgebung
  var MAX_CHECKINS = 1000;
  var MAX_UNDO = 25;

  var RARITY_BONUS_M = { diamond: 400, gold: 180, coal: 60, rock: 0 };

  function defaults() {
    return {
      v: 1,
      settings: {
        radiusM: 800,
        cooldownH: 24,
        linkM: 25,
        types: { rock: true, coal: true, gold: true, diamond: true },
        preferRare: true,
        skipHours: 3,
        routeOrder: true,
        maxTargets: 10
      },
      owners: {},
      mines: {},
      groups: {},
      checkIns: [],
      seq: 0
    };
  }

  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  /* Fehlende Felder auffuellen, damit alte/importierte Staende nicht crashen. */
  function migrate(raw) {
    var d = defaults();
    if (!raw || typeof raw !== 'object') return d;
    var rawSettings = raw.settings || {};
    var s = Object.assign({}, d, raw);
    s.settings = Object.assign({}, d.settings, rawSettings);
    s.settings.types = Object.assign({}, d.settings.types, rawSettings.types || {});
    s.owners = raw.owners || {};
    s.mines = raw.mines || {};
    s.groups = raw.groups || {};
    s.checkIns = Array.isArray(raw.checkIns) ? raw.checkIns : [];
    s.seq = raw.seq || 0;
    s.v = 1;
    return s;
  }

  function createStore(storage, opts) {
    opts = opts || {};
    var key = opts.key || STORAGE_KEY;
    var state = defaults();
    var undoStack = [];
    var listeners = [];

    function load() {
      try {
        var raw = storage ? storage.getItem(key) : null;
        state = migrate(raw ? JSON.parse(raw) : null);
      } catch (e) {
        state = defaults();
      }
      return state;
    }

    function save() {
      if (!storage) return;
      try { storage.setItem(key, JSON.stringify(state)); }
      catch (e) { /* Speicher voll / privater Modus — im UI wird gewarnt */ }
    }

    function emit() { listeners.forEach(function (fn) { try { fn(state); } catch (e) {} }); }
    function subscribe(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }

    function pushUndo(label) {
      undoStack.push({ label: label, snapshot: deepCopy(state) });
      if (undoStack.length > MAX_UNDO) undoStack.shift();
    }

    function undo() {
      var last = undoStack.pop();
      if (!last) return null;
      state = last.snapshot;
      save(); emit();
      return last.label;
    }

    function canUndo() { return undoStack.length > 0; }
    function undoLabel() { return undoStack.length ? undoStack[undoStack.length - 1].label : null; }

    // ── Einstellungen ───────────────────────────────────────────────────────
    function settings() { return state.settings; }
    function setSettings(patch) {
      patch = patch || {};
      var types = patch.types;                 // erst sichern: Object.assign wuerde das Teilobjekt einsetzen
      var rest = Object.assign({}, patch);
      delete rest.types;
      Object.assign(state.settings, rest);
      if (types) state.settings.types = Object.assign({}, state.settings.types, types);
      state.settings.cooldownH = util.clamp(Number(state.settings.cooldownH) || 24, 1, 168);
      state.settings.radiusM = util.clamp(Number(state.settings.radiusM) || 800, 100, 20000);
      state.settings.linkM = util.clamp(Number(state.settings.linkM) || 25, 5, 200);
      save(); emit();
    }

    function cooldownMs() { return state.settings.cooldownH * 3600000; }

    // ── Owner ───────────────────────────────────────────────────────────────
    function owners() { return state.owners; }
    function owner(k) { return k ? state.owners[k] || null : null; }
    function ownerName(k) { var o = owner(k); return o ? o.name : null; }

    function findOwnerByName(name) {
      var slug = util.ownerSlug(name);
      if (!slug) return null;
      var found = null;
      Object.keys(state.owners).forEach(function (k) {
        if (util.ownerSlug(state.owners[k].name) === slug) found = state.owners[k];
      });
      return found;
    }

    function createOwner(name, now) {
      state.seq += 1;
      var anon = !name || !String(name).trim();
      var k = 'o' + state.seq;
      state.owners[k] = {
        key: k,
        name: anon ? 'Owner #' + state.seq : String(name).trim(),
        anon: anon,
        createdAt: now,
        lastCheckInAt: 0,
        count: 0
      };
      return state.owners[k];
    }

    function ownerAvailableAt(k) {
      var o = owner(k);
      if (!o || !o.lastCheckInAt) return 0;
      return o.lastCheckInAt + cooldownMs();
    }

    /* Namen setzen; existiert der Name schon, werden beide Owner verschmolzen. */
    function renameOwner(k, name) {
      var o = owner(k);
      if (!o) return null;
      var trimmed = String(name || '').trim();
      if (!trimmed) return o;
      var existing = findOwnerByName(trimmed);
      pushUndo('Owner umbenannt');
      if (existing && existing.key !== k) {
        mergeInto(existing.key, k);
        save(); emit();
        return existing;
      }
      o.name = trimmed;
      o.anon = false;
      save(); emit();
      return o;
    }

    /* Alles von `fromKey` auf `intoKey` umhaengen. */
    function mergeInto(intoKey, fromKey) {
      var into = owner(intoKey), from = owner(fromKey);
      if (!into || !from || intoKey === fromKey) return;
      Object.keys(state.mines).forEach(function (mid) {
        if (state.mines[mid].owner === fromKey) state.mines[mid].owner = intoKey;
      });
      state.checkIns.forEach(function (c) { if (c.owner === fromKey) c.owner = intoKey; });
      into.lastCheckInAt = Math.max(into.lastCheckInAt || 0, from.lastCheckInAt || 0);
      into.count = (into.count || 0) + (from.count || 0);
      if (into.anon && !from.anon) { into.name = from.name; into.anon = false; }
      delete state.owners[fromKey];
    }

    function mergeOwners(intoKey, fromKey) {
      pushUndo('Owner zusammengefuehrt');
      mergeInto(intoKey, fromKey);
      save(); emit();
    }

    function deleteOwner(k) {
      if (!owner(k)) return;
      pushUndo('Owner geloescht');
      Object.keys(state.mines).forEach(function (mid) {
        if (state.mines[mid].owner === k) state.mines[mid].owner = null;
      });
      delete state.owners[k];
      save(); emit();
    }

    /* Cooldown eines Owners sofort aufheben (z. B. Fehleintrag). */
    function resetOwnerCooldown(k) {
      var o = owner(k);
      if (!o) return;
      pushUndo('Cooldown zurueckgesetzt');
      o.lastCheckInAt = 0;
      save(); emit();
    }

    // ── Minen ───────────────────────────────────────────────────────────────
    function mineRec(id) { return state.mines[id] || null; }
    function ensureMine(id, type) {
      if (!state.mines[id]) state.mines[id] = { owner: null, type: type || null, blockedUntil: 0, lastCheckInAt: 0 };
      else if (type && !state.mines[id].type) state.mines[id].type = type;
      return state.mines[id];
    }

    function blockMine(id, days, type) {
      pushUndo('Mine gesperrt');
      var m = ensureMine(id, type);
      m.blockedUntil = days && days > 0 ? Date.now() + days * 86400000 : FOREVER;
      save(); emit();
    }

    function unblockMine(id) {
      var m = state.mines[id];
      if (!m) return;
      pushUndo('Sperre aufgehoben');
      m.blockedUntil = 0;
      save(); emit();
    }

    // ── Gruppen (Cluster) ───────────────────────────────────────────────────
    function groupRec(gid) { return state.groups[gid] || null; }
    function ensureGroup(gid) {
      if (!state.groups[gid]) state.groups[gid] = { multiOwner: false, snoozeUntil: 0 };
      return state.groups[gid];
    }

    function setMultiOwner(gid, on) {
      pushUndo(on ? 'Als Mehr-Owner-Block markiert' : 'Mehr-Owner-Markierung entfernt');
      ensureGroup(gid).multiOwner = !!on;
      save(); emit();
    }

    function snoozeGroup(gid, hours) {
      pushUndo('Gruppe uebersprungen');
      ensureGroup(gid).snoozeUntil = Date.now() + (hours || state.settings.skipHours) * 3600000;
      save(); emit();
    }

    // ── Status-Berechnung ───────────────────────────────────────────────────
    /* Owner-Schluessel, die in dieser Gruppe bekannt sind. */
    function groupOwnerKeys(group) {
      var keys = [];
      group.mines.forEach(function (m) {
        var rec = state.mines[m.id];
        if (rec && rec.owner && keys.indexOf(rec.owner) < 0) keys.push(rec.owner);
      });
      return keys;
    }

    /* Check-ins innerhalb des Cooldown-Fensters. */
    function recentCheckIns(now) {
      var since = now - cooldownMs();
      return state.checkIns.filter(function (c) { return c.at > since; });
    }

    /* Status einer einzelnen Mine.
       state: 'free' | 'cooldown' | 'blocked' */
    function mineStatus(mine, group, now, recent) {
      var rec = state.mines[mine.id];
      if (rec && rec.blockedUntil && rec.blockedUntil > now) {
        return { state: 'blocked', until: rec.blockedUntil === FOREVER ? null : rec.blockedUntil, ownerKey: rec.owner || null };
      }
      var ownerKey = rec ? rec.owner : null;
      if (ownerKey) {
        var until = ownerAvailableAt(ownerKey);
        if (until > now) return { state: 'cooldown', until: until, ownerKey: ownerKey };
        return { state: 'free', until: 0, ownerKey: ownerKey };
      }
      // Unbekannter Owner: in gemischten Bloecken zaehlt nur die Naehe zu frischen Check-ins.
      var g = group ? state.groups[group.id] : null;
      if (g && g.multiOwner) {
        var blockUntil = 0;
        (recent || recentCheckIns(now)).forEach(function (c) {
          if (util.distance(mine.lat, mine.lng, c.lat, c.lng) <= MULTI_OWNER_RADIUS_M) {
            blockUntil = Math.max(blockUntil, c.at + cooldownMs());
          }
        });
        if (blockUntil > now) return { state: 'cooldown', until: blockUntil, ownerKey: null };
      }
      return { state: 'free', until: 0, ownerKey: null };
    }

    /* Status einer Gruppe inkl. bester noch freier Mine.
       state: 'free' | 'cooldown' | 'snoozed' | 'blocked' | 'filtered' */
    function groupStatus(group, now, recent) {
      recent = recent || recentCheckIns(now);
      var g = state.groups[group.id];
      var ownerKeys = groupOwnerKeys(group);
      var multi = !!(g && g.multiOwner);

      if (g && g.snoozeUntil > now) {
        return { state: 'snoozed', until: g.snoozeUntil, ownerKeys: ownerKeys, multi: multi, freeMines: [] };
      }

      // Normalfall: eine Gruppe = ein Owner. Cooldown eines bekannten Owners
      // sperrt die ganze Gruppe; ohne bekannten Owner zaehlt der letzte
      // Check-in irgendwo in der Gruppe.
      if (!multi) {
        var until = 0;
        ownerKeys.forEach(function (k) { until = Math.max(until, ownerAvailableAt(k)); });
        group.mines.forEach(function (m) {
          var rec = state.mines[m.id];
          // Nur Minen ohne zugeordneten Owner: bei zugeordneten zaehlt allein
          // der Owner-Cooldown (sonst laesst er sich nicht zuruecksetzen).
          if (rec && !rec.owner && rec.lastCheckInAt) until = Math.max(until, rec.lastCheckInAt + cooldownMs());
        });
        if (until > now) {
          return { state: 'cooldown', until: until, ownerKeys: ownerKeys, multi: multi, freeMines: [] };
        }
      }

      var free = [];
      group.mines.forEach(function (m) {
        if (mineStatus(m, group, now, recent).state === 'free') free.push(m);
      });
      if (!free.length) {
        var soonest = Infinity;
        group.mines.forEach(function (m) {
          var st = mineStatus(m, group, now, recent);
          if (st.state === 'cooldown' && st.until) soonest = Math.min(soonest, st.until);
        });
        return {
          state: soonest === Infinity ? 'blocked' : 'cooldown',
          until: soonest === Infinity ? null : soonest,
          ownerKeys: ownerKeys, multi: multi, freeMines: []
        };
      }
      return { state: 'free', until: 0, ownerKeys: ownerKeys, multi: multi, freeMines: free };
    }

    // ── Zielauswahl ─────────────────────────────────────────────────────────
    /* Liefert die naechsten Ziele — jeweils genau ein Vorschlag pro Owner,
       sortiert nach Laufweg (seltene Minen bekommen einen Bonus). */
    function selectTargets(groups, from, now, limit) {
      var recent = recentCheckIns(now);
      var types = state.settings.types;
      var preferRare = state.settings.preferRare;
      var seenOwners = {};
      var out = [];

      groups.forEach(function (group) {
        var st = groupStatus(group, now, recent);
        if (st.state !== 'free') return;

        // Zwei Cluster desselben Owners nie doppelt vorschlagen.
        var dupe = false;
        st.ownerKeys.forEach(function (k) { if (seenOwners[k]) dupe = true; });
        if (dupe) return;

        var best = null;
        st.freeMines.forEach(function (m) {
          if (types && types[m.type] === false) return;
          var d = util.distance(from.lat, from.lng, m.lat, m.lng);
          var score = d - (preferRare ? (RARITY_BONUS_M[m.type] || 0) : 0);
          if (!best || score < best.score) best = { mine: m, dist: d, score: score };
        });
        if (!best) return;

        st.ownerKeys.forEach(function (k) { seenOwners[k] = true; });
        out.push({
          group: group,
          mine: best.mine,
          distance: best.dist,
          score: best.score,
          bearing: util.bearing(from.lat, from.lng, best.mine.lat, best.mine.lng),
          ownerKey: st.ownerKeys[0] || null,
          ownerName: st.ownerKeys.length ? (owner(st.ownerKeys[0]) || {}).name : null,
          multi: st.multi,
          freeCount: st.freeMines.length
        });
      });

      out.sort(function (a, b) { return a.score - b.score; });
      return out.slice(0, limit || state.settings.maxTargets);
    }

    /* Ziele zu einer Laufrunde ketten: immer das naechste noch offene Ziel
       vom zuletzt erreichten Punkt aus. Liefert Etappen- und Gesamtstrecke. */
    function routeTargets(targets, from) {
      var remaining = targets.slice(), out = [], cur = from, total = 0;
      while (remaining.length) {
        var bi = 0, bd = Infinity;
        for (var i = 0; i < remaining.length; i++) {
          var d = util.distance(cur.lat, cur.lng, remaining[i].mine.lat, remaining[i].mine.lng);
          if (d < bd) { bd = d; bi = i; }
        }
        var t = remaining.splice(bi, 1)[0];
        total += bd;
        out.push(Object.assign({}, t, {
          legDistance: bd,
          totalDistance: total,
          bearing: util.bearing(cur.lat, cur.lng, t.mine.lat, t.mine.lng)
        }));
        cur = t.mine;
      }
      return out;
    }

    // ── Check-in ────────────────────────────────────────────────────────────
    /* Bucht einen Check-in: setzt den Owner-Cooldown und merkt sich die
       Owner-Zuordnung fuer alle Minen der Gruppe (bzw. nur fuer die eine
       Mine, wenn der Block als Mehr-Owner-Block markiert ist). */
    function checkIn(opts, now) {
      now = now || Date.now();
      var mine = opts.mine, group = opts.group, name = opts.ownerName;
      if (!mine) return null;
      pushUndo('Check-in bei ' + (name || 'Mine ' + mine.id));

      var g = group ? state.groups[group.id] : null;
      var multi = !!(g && g.multiOwner);
      var rec = ensureMine(mine.id, mine.type);
      var target = null;

      if (name && String(name).trim()) {
        var existing = findOwnerByName(name);
        // Anonymen Cluster-Owner umbenennen statt einen zweiten anzulegen.
        var current = rec.owner ? owner(rec.owner) : (group && !multi ? owner(groupOwnerKeys(group)[0]) : null);
        if (existing) {
          target = existing;
          if (current && current.key !== existing.key && current.anon) mergeInto(existing.key, current.key);
        } else if (current && current.anon) {
          current.name = String(name).trim();
          current.anon = false;
          target = current;
        } else {
          target = createOwner(name, now);
        }
      } else {
        var known = rec.owner || (group && !multi ? groupOwnerKeys(group)[0] : null);
        target = known ? owner(known) : createOwner(null, now);
      }

      rec.owner = target.key;
      rec.lastCheckInAt = now;
      if (group && !multi) {
        group.mines.forEach(function (m) {
          var r = ensureMine(m.id, m.type);
          if (!r.owner) r.owner = target.key;
        });
      }

      target.lastCheckInAt = now;
      target.count = (target.count || 0) + 1;

      state.checkIns.unshift({
        at: now, mineId: mine.id, lat: mine.lat, lng: mine.lng,
        type: mine.type || null, owner: target.key, groupId: group ? group.id : null
      });
      if (state.checkIns.length > MAX_CHECKINS) state.checkIns.length = MAX_CHECKINS;

      save(); emit();
      return { owner: target, at: now };
    }

    /* Einen einzelnen Check-in verwerfen (Fehleintrag, auch spaeter noch).
       Der Owner-Cooldown richtet sich danach nach dem naechstjuengeren Eintrag. */
    function deleteCheckIn(index) {
      var entry = state.checkIns[index];
      if (!entry) return false;
      pushUndo('Check-in geloescht');
      state.checkIns.splice(index, 1);

      var o = owner(entry.owner);
      if (o) {
        var newest = 0;
        state.checkIns.forEach(function (c) { if (c.owner === o.key && c.at > newest) newest = c.at; });
        o.lastCheckInAt = newest;
        o.count = Math.max(0, (o.count || 1) - 1);
      }
      var rec = state.mines[entry.mineId];
      if (rec && rec.lastCheckInAt === entry.at) {
        var newestMine = 0;
        state.checkIns.forEach(function (c) { if (c.mineId === entry.mineId && c.at > newestMine) newestMine = c.at; });
        rec.lastCheckInAt = newestMine;
      }
      save(); emit();
      return true;
    }

    // ── Statistik ───────────────────────────────────────────────────────────
    function stats(now) {
      now = now || Date.now();
      var dayStart = util.startOfDay(now);
      var todayOwners = {};
      var todayCount = 0;
      state.checkIns.forEach(function (c) {
        if (c.at >= dayStart) { todayCount++; if (c.owner) todayOwners[c.owner] = true; }
      });
      var distinct = Object.keys(todayOwners).length;
      var next = distinct < 3 ? { need: 3, bonus: 10 } : distinct < 5 ? { need: 5, bonus: 25 } : distinct < 10 ? { need: 10, bonus: 50 } : null;
      var onCooldown = 0;
      Object.keys(state.owners).forEach(function (k) { if (ownerAvailableAt(k) > now) onCooldown++; });
      return {
        todayOwners: distinct,
        todayCheckIns: todayCount,
        nextMilestone: next,
        totalCheckIns: state.checkIns.length,
        ownersKnown: Object.keys(state.owners).length,
        ownersOnCooldown: onCooldown
      };
    }

    // ── Import / Export ─────────────────────────────────────────────────────
    function exportJson() { return JSON.stringify(state, null, 2); }

    function importJson(text, mode) {
      var incoming = migrate(JSON.parse(text));
      pushUndo('Daten importiert');
      if (mode === 'replace') {
        state = incoming;
      } else {
        // Zusammenfuehren: Owner nach Namen matchen, spaetester Check-in gewinnt.
        var map = {};
        Object.keys(incoming.owners).forEach(function (k) {
          var inc = incoming.owners[k];
          var mine_ = inc.anon ? null : findOwnerByName(inc.name);
          if (mine_) {
            map[k] = mine_.key;
            mine_.lastCheckInAt = Math.max(mine_.lastCheckInAt || 0, inc.lastCheckInAt || 0);
            mine_.count = (mine_.count || 0) + (inc.count || 0);
          } else {
            state.seq += 1;
            while (state.owners['o' + state.seq]) state.seq += 1;   // keinen vorhandenen Schluessel ueberschreiben
            var nk = 'o' + state.seq;
            map[k] = nk;
            state.owners[nk] = Object.assign({}, inc, { key: nk });
          }
        });
        Object.keys(incoming.mines).forEach(function (mid) {
          var inc = incoming.mines[mid];
          var cur = state.mines[mid];
          var mapped = inc.owner ? map[inc.owner] || null : null;
          if (!cur) state.mines[mid] = Object.assign({}, inc, { owner: mapped });
          else {
            if (!cur.owner && mapped) cur.owner = mapped;
            cur.lastCheckInAt = Math.max(cur.lastCheckInAt || 0, inc.lastCheckInAt || 0);
            cur.blockedUntil = Math.max(cur.blockedUntil || 0, inc.blockedUntil || 0);
          }
        });
        Object.keys(incoming.groups).forEach(function (gid) {
          var inc = incoming.groups[gid], cur = state.groups[gid];
          if (!cur) state.groups[gid] = Object.assign({}, inc);
          else {
            cur.multiOwner = cur.multiOwner || inc.multiOwner;
            cur.snoozeUntil = Math.max(cur.snoozeUntil || 0, inc.snoozeUntil || 0);
          }
        });
        var seen = {};
        state.checkIns = state.checkIns
          .concat(incoming.checkIns.map(function (c) { return Object.assign({}, c, { owner: map[c.owner] || c.owner }); }))
          .filter(function (c) { var k = c.at + '|' + c.mineId; if (seen[k]) return false; seen[k] = true; return true; })
          .sort(function (a, b) { return b.at - a.at; })
          .slice(0, MAX_CHECKINS);
      }
      save(); emit();
      return state;
    }

    function reset() {
      pushUndo('Alles zurueckgesetzt');
      state = defaults();
      save(); emit();
    }

    function raw() { return state; }

    load();

    return {
      FOREVER: FOREVER,
      load: load, save: save, subscribe: subscribe, raw: raw, reset: reset,
      settings: settings, setSettings: setSettings, cooldownMs: cooldownMs,
      owners: owners, owner: owner, ownerName: ownerName, createOwner: createOwner,
      findOwnerByName: findOwnerByName, ownerAvailableAt: ownerAvailableAt,
      renameOwner: renameOwner, mergeOwners: mergeOwners, deleteOwner: deleteOwner,
      resetOwnerCooldown: resetOwnerCooldown,
      mineRec: mineRec, ensureMine: ensureMine, blockMine: blockMine, unblockMine: unblockMine,
      groupRec: groupRec, ensureGroup: ensureGroup, setMultiOwner: setMultiOwner, snoozeGroup: snoozeGroup,
      groupOwnerKeys: groupOwnerKeys, groupStatus: groupStatus, mineStatus: mineStatus,
      selectTargets: selectTargets, routeTargets: routeTargets, checkIn: checkIn, deleteCheckIn: deleteCheckIn, stats: stats,
      exportJson: exportJson, importJson: importJson,
      undo: undo, canUndo: canUndo, undoLabel: undoLabel
    };
  }

  return { createStore: createStore, STORAGE_KEY: STORAGE_KEY, FOREVER: FOREVER, defaults: defaults, migrate: migrate };
});
