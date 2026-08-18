/* Zugriff auf die oeffentlichen TerraMine-Endpunkte.

   Es sind exakt die Endpunkte, die terramine.app/heatmap.html selbst nutzt:
     getPropertiesInViewport -> exakte Minen (lat/lng/type) in einer Bounding-Box
     getHeatmapData          -> weltweiter, vorberechneter Dichte-Cache (~3,6 MB)
   Beide antworten mit CORS fuer jede Origin, laufen also direkt von GitHub Pages.
   Owner-IDs liefert die API nicht — die schaetzt cluster.js und bestaetigst du
   selbst beim Abhaken. */
(function (root, factory) {
  var api = factory(root.TM.util);
  root.TM = Object.assign(root.TM || {}, { api: api });
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util) {
  'use strict';

  var BASE = 'https://us-central1-terramine-5cda5.cloudfunctions.net';
  var VIEWPORT_URL = BASE + '/getPropertiesInViewport';
  var HEATMAP_URL = BASE + '/getHeatmapData';
  var CACHE_KEY = 'terramine-owner-radar:lastfetch';
  var CACHE_TTL = 60000;                 // der Server erlaubt 60 s Cache
  var MAX_RADIUS_M = 5000;               // groessere Boxen werden serverseitig gekuerzt

  var memCache = new Map();
  var inflight = null;

  function bboxKey(b) {
    return [b.minLat, b.maxLat, b.minLng, b.maxLng].map(function (v) { return v.toFixed(4); }).join('|');
  }

  function normalize(list) {
    var seen = Object.create(null), out = [];
    (list || []).forEach(function (p) {
      if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
      var id = util.mineId(p.lat, p.lng);
      if (seen[id]) return;
      seen[id] = 1;
      out.push({ id: id, lat: p.lat, lng: p.lng, type: p.type || 'rock' });
    });
    return out;
  }

  /* Kern: Minen in einer Bounding-Box laden. */
  function fetchMinesInBounds(bbox, meta, force) {
    var key = bboxKey(bbox);
    var now = Date.now();

    var hit = memCache.get(key);
    // Beim manuellen Neuladen den kurzen Zwischenspeicher ueberspringen.
    if (!force && hit && now - hit.fetchedAt < CACHE_TTL) return Promise.resolve(hit);

    if (inflight) { try { inflight.abort(); } catch (e) {} }
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    inflight = ctrl;

    var url = VIEWPORT_URL +
      '?minLat=' + bbox.minLat + '&maxLat=' + bbox.maxLat +
      '&minLng=' + bbox.minLng + '&maxLng=' + bbox.maxLng;

    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (res) {
        if (!res.ok) throw new Error('Server antwortete mit ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var result = {
          mines: normalize(data.properties),
          truncated: !!data.truncated,
          center: (meta && meta.center) || {
            lat: (bbox.minLat + bbox.maxLat) / 2,
            lng: (bbox.minLng + bbox.maxLng) / 2
          },
          radiusM: (meta && meta.radiusM) || null,
          bbox: bbox,
          fetchedAt: Date.now()
        };
        memCache.set(key, result);
        if (memCache.size > 12) memCache.delete(memCache.keys().next().value);
        saveCache(result);
        return result;
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') throw err;
        throw new Error('Minen konnten nicht geladen werden (' + (err.message || err) + '). ' +
          'Pruefe die Internetverbindung — die Daten kommen live von terramine.app.');
      })
      .finally(function () { if (inflight === ctrl) inflight = null; });
  }

  /* Minen im Umkreis eines Punktes laden. */
  function fetchMines(lat, lng, radiusM, force) {
    radiusM = Math.min(radiusM || 800, MAX_RADIUS_M);
    var bbox = util.bboxFromRadius(lat, lng, radiusM);
    return fetchMinesInBounds(bbox, { center: { lat: lat, lng: lng }, radiusM: radiusM }, force);
  }

  /* Letzten Abruf lokal sichern, damit die App bei schlechtem Empfang
     unterwegs weiterhin Ziele anzeigen kann. */
  function saveCache(result) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        center: result.center, radiusM: result.radiusM,
        fetchedAt: result.fetchedAt, mines: result.mines.slice(0, 4000)
      }));
    } catch (e) { /* Quota — nicht kritisch */ }
  }

  function loadCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || !Array.isArray(c.mines)) return null;
      return { mines: c.mines, center: c.center, radiusM: c.radiusM, fetchedAt: c.fetchedAt, truncated: false, cached: true };
    } catch (e) { return null; }
  }

  /* Weltweiter Dichte-Cache (~3,6 MB) — einmal laden, 24 h lokal behalten.
     opts: { force, onProgress(geladenBytes, gesamtBytes) } */
  var WORLD_CACHE = 'owner-radar-world-v1';
  var WORLD_TS_KEY = 'terramine-owner-radar:worldts';
  var WORLD_TTL = 24 * 3600000;
  var worldMemory = null;

  function worldAge() {
    try { return Date.now() - (parseInt(localStorage.getItem(WORLD_TS_KEY), 10) || 0); }
    catch (e) { return Infinity; }
  }

  function hasWorldCache() {
    return !!worldMemory || worldAge() < WORLD_TTL;
  }

  function parseWorld(json) {
    return {
      cells: json.cells || [],
      generatedAt: json.generatedAt,
      totalProperties: json.totalProperties,
      totalsByType: json.totalsByType,
      cellSizeDegrees: json.cellSizeDegrees || 0.02
    };
  }

  function fetchWorldCells(opts) {
    opts = opts || {};
    if (worldMemory && !opts.force) return Promise.resolve(worldMemory);

    var fromCache = (!opts.force && typeof caches !== 'undefined' && worldAge() < WORLD_TTL)
      ? caches.open(WORLD_CACHE).then(function (c) { return c.match(HEATMAP_URL); })
          .then(function (hit) { return hit ? hit.json() : null; })
          .catch(function () { return null; })
      : Promise.resolve(null);

    return fromCache.then(function (cached) {
      if (cached) {
        worldMemory = parseWorld(cached);
        return worldMemory;
      }
      return downloadWorld(opts.onProgress);
    });
  }

  function downloadWorld(onProgress) {
    return fetch(HEATMAP_URL).then(function (res) {
      if (!res.ok) throw new Error('Server antwortete mit ' + res.status);
      var total = parseInt(res.headers.get('content-length'), 10) || 0;

      // Ohne Stream-Unterstuetzung einfach normal einlesen.
      if (!res.body || !res.body.getReader || !onProgress) return res.text();

      var reader = res.body.getReader();
      var chunks = [], loaded = 0;
      return (function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            var all = new Uint8Array(loaded), at = 0;
            chunks.forEach(function (ch) { all.set(ch, at); at += ch.length; });
            return new TextDecoder('utf-8').decode(all);
          }
          chunks.push(r.value);
          loaded += r.value.length;
          onProgress(loaded, total);
          return pump();
        });
      })();
    }).then(function (text) {
      var json = JSON.parse(text);
      worldMemory = parseWorld(json);
      try {
        localStorage.setItem(WORLD_TS_KEY, String(Date.now()));
        if (typeof caches !== 'undefined') {
          caches.open(WORLD_CACHE).then(function (c) {
            c.put(HEATMAP_URL, new Response(text, { headers: { 'Content-Type': 'application/json' } }));
          }).catch(function () {});
        }
      } catch (e) { /* privater Modus / Quota */ }
      return worldMemory;
    }).catch(function (err) {
      throw new Error('Weltdaten konnten nicht geladen werden (' + (err.message || err) + ').');
    });
  }

  return {
    fetchMines: fetchMines, fetchMinesInBounds: fetchMinesInBounds,
    fetchWorldCells: fetchWorldCells, hasWorldCache: hasWorldCache,
    loadCache: loadCache, MAX_RADIUS_M: MAX_RADIUS_M,
    VIEWPORT_URL: VIEWPORT_URL, HEATMAP_URL: HEATMAP_URL
  };
});
