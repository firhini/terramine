/* Zufallsorte weltweit.

   Grundlage ist der oeffentliche Dichte-Cache der TerraMine-Weltkarte:
   rund 44.000 Zellen a 0,02 Grad (~2 km) mit den Minenzahlen je Typ.
   Daraus wird eine Zelle gezogen, deren exakte Minen danach ueber den
   normalen Viewport-Endpunkt geladen werden. */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var api = factory(isNode ? require('./util.js') : root.TM.util);
  if (isNode) module.exports = api;
  root.TM = Object.assign(root.TM || {}, { world: api });
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util) {
  'use strict';

  var CELL_DEG = 0.02;
  var PAD_DEG = 0.004;      // etwas Rand, weil der Zellpunkt der Schwerpunkt ist, nicht die Mitte

  function cellTotal(c) { return (c.rock || 0) + (c.coal || 0) + (c.gold || 0) + (c.diamond || 0); }
  function cellKey(c) { return c.lat.toFixed(3) + ',' + c.lng.toFixed(3); }

  /* Zellen nach Mindestgroesse und gewuenschtem Minentyp einschraenken.
     opts: { minMines, requireType: 'any'|'coal'|'gold'|'diamond', exclude: {key:true} } */
  function filterCells(cells, opts) {
    opts = opts || {};
    var minMines = opts.minMines || 1;
    var type = opts.requireType && opts.requireType !== 'any' ? opts.requireType : null;
    var exclude = opts.exclude || {};
    var out = [];
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (cellTotal(c) < minMines) continue;
      if (type && !(c[type] > 0)) continue;
      if (exclude[cellKey(c)]) continue;
      out.push(c);
    }
    return out;
  }

  /* Eine Zelle zufaellig ziehen. Ohne Treffer wird die Einschraenkung
     schrittweise gelockert, damit der Wuerfel nie ins Leere laeuft. */
  function pickCell(cells, opts, rng) {
    rng = rng || Math.random;
    opts = opts || {};
    var attempts = [
      opts,
      Object.assign({}, opts, { exclude: {} }),                                  // besuchte wieder zulassen
      Object.assign({}, opts, { exclude: {}, minMines: 1 }),                     // Mindestgroesse fallen lassen
      { minMines: 1, requireType: 'any', exclude: {} }                           // alles zulassen
    ];
    for (var i = 0; i < attempts.length; i++) {
      var pool = filterCells(cells, attempts[i]);
      if (pool.length) {
        return { cell: pool[Math.floor(rng() * pool.length)], relaxed: i > 0, poolSize: pool.length };
      }
    }
    return null;
  }

  /* Suchfenster einer Zelle fuer den Viewport-Endpunkt. */
  function cellBbox(cell, cellDeg, padDeg) {
    var half = (cellDeg || CELL_DEG) / 2 + (padDeg == null ? PAD_DEG : padDeg);
    return {
      minLat: util.clamp(cell.lat - half, -90, 90),
      maxLat: util.clamp(cell.lat + half, -90, 90),
      minLng: util.clamp(cell.lng - half, -180, 180),
      maxLng: util.clamp(cell.lng + half, -180, 180)
    };
  }

  /* Kurzbeschreibung der Zelle fuer die Oberflaeche. */
  function describeCell(cell) {
    var parts = [];
    if (cell.diamond) parts.push('💎 ' + cell.diamond);
    if (cell.gold) parts.push('⭐ ' + cell.gold);
    if (cell.coal) parts.push('⚫ ' + cell.coal);
    if (cell.rock) parts.push('🪨 ' + cell.rock);
    return parts.join(' · ');
  }

  return {
    CELL_DEG: CELL_DEG, cellTotal: cellTotal, cellKey: cellKey,
    filterCells: filterCells, pickCell: pickCell, cellBbox: cellBbox, describeCell: describeCell
  };
});
