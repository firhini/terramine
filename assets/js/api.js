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

  /* Minen im Umkreis laden. Gibt immer ein Ergebnis zurueck oder wirft
     einen Fehler mit deutscher Meldung. */
  function fetchMines(lat, lng, radiusM, force) {
    radiusM = Math.min(radiusM || 800, MAX_RADIUS_M);
    var bbox = util.bboxFromRadius(lat, lng, radiusM);
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
          center: { lat: lat, lng: lng },
          radiusM: radiusM,
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

  /* Weltweiter Dichte-Cache — nur auf Wunsch laden, ~3,6 MB. */
  function fetchWorldCells() {
    return fetch(HEATMAP_URL)
      .then(function (res) {
        if (!res.ok) throw new Error('Server antwortete mit ' + res.status);
        return res.json();
      })
      .then(function (d) {
        return {
          cells: d.cells || [],
          generatedAt: d.generatedAt,
          totalProperties: d.totalProperties,
          totalsByType: d.totalsByType
        };
      });
  }

  return {
    fetchMines: fetchMines, fetchWorldCells: fetchWorldCells,
    loadCache: loadCache, MAX_RADIUS_M: MAX_RADIUS_M,
    VIEWPORT_URL: VIEWPORT_URL, HEATMAP_URL: HEATMAP_URL
  };
});
