/* Gruppiert Minen zu Besitz-Clustern.

   Warum: die oeffentliche TerraMine-API liefert pro Mine nur lat/lng/type —
   keine Owner-ID. Spieler bauen ihre TerraAcres aber praktisch immer als
   zusammenhaengenden Block um Zuhause/Arbeit (siehe Player's Guide), also
   ist ein zusammenhaengender Block die beste Schaetzung fuer "ein Owner".
   Bestaetigte Owner-Namen aus dem Store korrigieren die Schaetzung spaeter. */
(function (root, factory) {
  var api = factory(typeof module === 'object' && module.exports ? require('./util.js') : root.TM.util);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TM = Object.assign(root.TM || {}, { cluster: api });
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util) {
  'use strict';

  var TYPES = ['rock', 'coal', 'gold', 'diamond'];

  /* Union-Find mit Pfadverkuerzung. */
  function makeUF(n) {
    var parent = new Int32Array(n), rank = new Int8Array(n), i;
    for (i = 0; i < n; i++) parent[i] = i;
    function find(a) {
      while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
      return a;
    }
    function union(a, b) {
      var ra = find(a), rb = find(b);
      if (ra === rb) return;
      if (rank[ra] < rank[rb]) { parent[ra] = rb; }
      else if (rank[ra] > rank[rb]) { parent[rb] = ra; }
      else { parent[rb] = ra; rank[ra]++; }
    }
    return { find: find, union: union };
  }

  /* mines: [{ id?, lat, lng, type }], linkM: Verbindungsabstand in Metern.
     Rueckgabe: Cluster, absteigend nach Groesse. */
  function clusterMines(mines, linkM) {
    var out = [], i, j;
    if (!mines || !mines.length) return out;
    linkM = linkM > 0 ? linkM : 25;

    // Projektion in ein lokales Meter-Raster (ausreichend fuer Stadtgroesse).
    var latRef = mines[0].lat;
    var mPerLng = util.M_PER_DEG_LAT * Math.max(0.01, Math.cos(util.toRad(latRef)));
    var xs = new Float64Array(mines.length), ys = new Float64Array(mines.length);
    var buckets = new Map();
    for (i = 0; i < mines.length; i++) {
      xs[i] = mines[i].lng * mPerLng;
      ys[i] = mines[i].lat * util.M_PER_DEG_LAT;
      var key = Math.floor(xs[i] / linkM) + ':' + Math.floor(ys[i] / linkM);
      var b = buckets.get(key);
      if (b) b.push(i); else buckets.set(key, [i]);
    }

    // Nur Nachbarzellen pruefen -> linear statt O(n^2).
    var uf = makeUF(mines.length), limit = linkM * linkM;
    buckets.forEach(function (idxs, key) {
      var p = key.split(':'), cx = parseInt(p[0], 10), cy = parseInt(p[1], 10);
      for (var dx = 0; dx <= 1; dx++) {
        for (var dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy < 0) continue;               // jedes Paar nur einmal
          var other = buckets.get((cx + dx) + ':' + (cy + dy));
          if (!other) continue;
          var same = (dx === 0 && dy === 0);
          for (var a = 0; a < idxs.length; a++) {
            var i2 = idxs[a];
            for (var b2 = same ? a + 1 : 0; b2 < other.length; b2++) {
              var j2 = other[b2];
              var ddx = xs[i2] - xs[j2], ddy = ys[i2] - ys[j2];
              if (ddx * ddx + ddy * ddy <= limit) uf.union(i2, j2);
            }
          }
        }
      }
    });

    var groups = new Map();
    for (i = 0; i < mines.length; i++) {
      var r = uf.find(i), g = groups.get(r);
      if (g) g.push(mines[i]); else groups.set(r, [mines[i]]);
    }

    groups.forEach(function (list) {
      var counts = { rock: 0, coal: 0, gold: 0, diamond: 0 };
      var sLat = 0, sLng = 0, id = null;
      for (j = 0; j < list.length; j++) {
        var m = list[j];
        if (counts[m.type] != null) counts[m.type]++;
        sLat += m.lat; sLng += m.lng;
        var mid = m.id || util.mineId(m.lat, m.lng);
        if (id === null || mid < id) id = mid;           // kleinste Minen-ID = stabile Cluster-ID
      }
      list.sort(function (a, b) { return (a.id || '') < (b.id || '') ? -1 : 1; });
      out.push({
        id: 'g:' + id,
        mines: list,
        size: list.length,
        counts: counts,
        center: { lat: sLat / list.length, lng: sLng / list.length }
      });
    });

    out.sort(function (a, b) { return b.size - a.size; });
    return out;
  }

  /* Wertvollster Minentyp einer Gruppe (Diamant > Gold > Kohle > Stein). */
  function bestType(counts) {
    for (var i = TYPES.length - 1; i >= 0; i--) if (counts[TYPES[i]] > 0) return TYPES[i];
    return 'rock';
  }

  return { clusterMines: clusterMines, bestType: bestType, TYPES: TYPES };
});
