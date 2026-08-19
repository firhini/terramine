/* TerraMine Owner Radar — Geo-, Zeit- und Formathelfer.
   Laeuft sowohl im Browser (global TM.util) als auch in Node (require). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TM = Object.assign(root.TM || {}, { util: api });
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EARTH_R = 6371008.8;          // mittlerer Erdradius in Metern
  var M_PER_DEG_LAT = 111320;       // gute Naeherung fuer Breitengrade
  var GRID_DEG = 0.0001;            // Kantenlaenge eines TerraAcre in Grad (~11 m)

  function toRad(d) { return d * Math.PI / 180; }
  function toDeg(r) { return r * 180 / Math.PI; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* Entfernung in Metern (Haversine). */
  function distance(aLat, aLng, bLat, bLng) {
    var dLat = toRad(bLat - aLat);
    var dLng = toRad(bLng - aLng);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /* Kompasskurs von A nach B in Grad (0 = Norden). */
  function bearing(aLat, aLng, bLat, bLng) {
    var y = Math.sin(toRad(bLng - aLng)) * Math.cos(toRad(bLat));
    var x = Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) -
            Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLng - aLng));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  /* Sprache wirkt auf Himmelsrichtungen, Dezimaltrennzeichen und Datum. */
  var locale = 'en';
  function setLocale(l) { locale = l === 'de' ? 'de' : 'en'; return locale; }
  function getLocale() { return locale; }

  var COMPASS = {
    en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
    de: ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW']
  };
  function compass(deg) { return COMPASS[locale][Math.round(((deg % 360) + 360) % 360 / 45) % 8]; }

  /* Bounding-Box um einen Punkt mit Radius in Metern. */
  function bboxFromRadius(lat, lng, radiusM) {
    var dLat = radiusM / M_PER_DEG_LAT;
    var cos = Math.cos(toRad(clamp(lat, -89.5, 89.5)));
    var dLng = radiusM / (M_PER_DEG_LAT * Math.max(0.01, Math.abs(cos)));
    return {
      minLat: clamp(lat - dLat, -90, 90),
      maxLat: clamp(lat + dLat, -90, 90),
      minLng: clamp(lng - dLng, -180, 180),
      maxLng: clamp(lng + dLng, -180, 180)
    };
  }

  /* Stabile ID einer Mine: das Spiel rastert auf 0.0001 Grad,
     Zellmittelpunkte enden auf ...5 => 5 Nachkommastellen sind exakt. */
  function mineId(lat, lng) { return lat.toFixed(5) + ',' + lng.toFixed(5); }

  function parseMineId(id) {
    var p = String(id).split(',');
    return { lat: parseFloat(p[0]), lng: parseFloat(p[1]) };
  }

  /* Koordinaten-Eingabe: "40.70355, -73.99375" oder "40.70355 -73.99375". */
  function parseLatLng(text) {
    if (!text) return null;
    var m = String(text).replace(/[()]/g, ' ')
      .match(/(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)/);
    if (!m) return null;
    var lat = parseFloat(m[1].replace(',', '.'));
    var lng = parseFloat(m[2].replace(',', '.'));
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  }

  function fmtCoord(lat, lng) { return lat.toFixed(5) + ', ' + lng.toFixed(5); }

  function fmtDist(m) {
    if (!isFinite(m)) return '–';
    if (m < 1000) return Math.round(m) + ' m';
    var km = (m / 1000).toFixed(m < 10000 ? 2 : 1);
    return (locale === 'de' ? km.replace('.', ',') : km) + ' km';
  }

  /* Restdauer als "7 h 12 min" / "43 min" / "jetzt". */
  function fmtDuration(ms) {
    if (!isFinite(ms) || ms <= 0) return locale === 'de' ? 'jetzt' : 'now';
    var min = Math.ceil(ms / 60000);
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), rest = min % 60;
    if (h < 48) return h + ' h' + (rest ? ' ' + rest + ' min' : '');
    var d = Math.floor(h / 24);
    return d + (locale === 'de' ? ' T' : ' d') + (h % 24 ? ' ' + (h % 24) + ' h' : '');
  }

  function fmtClock(ts) {
    var d = new Date(ts);
    return d.toLocaleString(locale === 'de' ? 'de-DE' : 'en-GB',
      { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  /* Beginn des lokalen Tages (fuer die Tages-Streak). */
  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Normalisierter Schluessel fuer Ownernamen (Gross/Klein + Leerzeichen egal). */
  function ownerSlug(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  return {
    EARTH_R: EARTH_R, M_PER_DEG_LAT: M_PER_DEG_LAT, GRID_DEG: GRID_DEG,
    toRad: toRad, toDeg: toDeg, clamp: clamp,
    setLocale: setLocale, getLocale: getLocale,
    distance: distance, bearing: bearing, compass: compass,
    bboxFromRadius: bboxFromRadius,
    mineId: mineId, parseMineId: parseMineId, parseLatLng: parseLatLng,
    fmtCoord: fmtCoord, fmtDist: fmtDist, fmtDuration: fmtDuration, fmtClock: fmtClock,
    startOfDay: startOfDay, escapeHtml: escapeHtml, ownerSlug: ownerSlug
  };
});
