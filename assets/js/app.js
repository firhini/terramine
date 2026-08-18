/* Owner Radar — UI-Steuerung.
   Kernlogik liegt in store.js / cluster.js (siehe tests/run.js). */
(function () {
  'use strict';

  var util = TM.util, cluster = TM.cluster, api = TM.api;
  var store = TM.store.createStore(window.localStorage);
  var POS_KEY = 'terramine-owner-radar:pos';

  var TYPE_META = {
    rock:    { emoji: '🪨', name: 'Stein' },
    coal:    { emoji: '⚫', name: 'Kohle' },
    gold:    { emoji: '⭐', name: 'Gold' },
    diamond: { emoji: '💎', name: 'Diamant' }
  };

  var app = {
    pos: null,            // { lat, lng, acc, at, source }
    watchId: null,
    mines: [],
    groups: [],
    targets: [],
    fetchedAt: 0,
    fetchCenter: null,
    truncated: false,
    loading: false,
    pinnedMineId: null,
    view: 'radar',
    map: null, mapReady: false, mineLayer: null, meLayer: null, radiusLayer: null,
    mapDirty: true
  };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function now() { return Date.now(); }
  function felder(n) { return n + (n === 1 ? ' Feld' : ' Felder'); }

  // ── Toast / Sheet ─────────────────────────────────────────────────────────
  var toastTimer = null;
  function toast(msg, kind) {
    var t = $('toast');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, kind === 'err' ? 6000 : 3400);
  }

  function openSheet(title, buildBody) {
    $('sheet-title').textContent = title;
    var body = $('sheet-body');
    body.innerHTML = '';
    buildBody(body);
    $('sheet-backdrop').hidden = false;
  }
  function closeSheet() { $('sheet-backdrop').hidden = true; }

  // ── Standort ──────────────────────────────────────────────────────────────
  function setPosition(lat, lng, acc, source) {
    app.pos = { lat: lat, lng: lng, acc: acc == null ? null : acc, at: now(), source: source || 'manual' };
    try { localStorage.setItem(POS_KEY, JSON.stringify(app.pos)); } catch (e) {}
    maybeAutoRefresh();
    recompute();
    renderAll();
    updateMeOnMap();
  }

  function restorePosition() {
    try {
      var p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (p && isFinite(p.lat) && isFinite(p.lng)) app.pos = p;
    } catch (e) {}
  }

  function geoError(err) {
    var msg = 'Standort nicht verfuegbar.';
    if (err && err.code === 1) msg = 'Standortfreigabe abgelehnt — erlaube den Zugriff oder trage die Koordinaten manuell ein.';
    else if (err && err.code === 2) msg = 'Kein GPS-Signal. Draussen erneut versuchen oder Koordinaten manuell eintragen.';
    else if (err && err.code === 3) msg = 'GPS hat zu lange gebraucht. Nochmal versuchen.';
    toast(msg, 'err');
  }

  function locate() {
    if (!navigator.geolocation) { toast('Dieser Browser kann keinen Standort ermitteln.', 'err'); return; }
    $('btn-locate').disabled = true;
    $('btn-locate').textContent = '…';
    navigator.geolocation.getCurrentPosition(function (p) {
      $('btn-locate').disabled = false;
      $('btn-locate').textContent = 'GPS';
      setPosition(p.coords.latitude, p.coords.longitude, p.coords.accuracy, 'gps');
      refresh();
    }, function (e) {
      $('btn-locate').disabled = false;
      $('btn-locate').textContent = 'GPS';
      geoError(e);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 });
  }

  function setFollow(on) {
    if (on) {
      if (!navigator.geolocation) { toast('Dieser Browser kann keinen Standort ermitteln.', 'err'); $('chk-follow').checked = false; return; }
      app.watchId = navigator.geolocation.watchPosition(function (p) {
        setPosition(p.coords.latitude, p.coords.longitude, p.coords.accuracy, 'gps');
      }, geoError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 25000 });
    } else if (app.watchId != null) {
      navigator.geolocation.clearWatch(app.watchId);
      app.watchId = null;
    }
  }

  // ── Daten laden ───────────────────────────────────────────────────────────
  function maybeAutoRefresh() {
    if (!app.pos || app.loading) return;
    if (!app.fetchCenter) return;
    var moved = util.distance(app.pos.lat, app.pos.lng, app.fetchCenter.lat, app.fetchCenter.lng);
    var s = store.settings();
    // Neu laden, sobald der alte Umkreis den aktuellen Standort nicht mehr gut abdeckt.
    if (moved > Math.max(250, s.radiusM * 0.35)) refresh();
  }

  function refresh(force) {
    if (!app.pos) { toast('Erst Standort setzen — GPS antippen oder Koordinaten eintragen.', 'err'); return; }
    if (app.loading) return;
    app.loading = true;
    $('btn-refresh').classList.add('spin');
    var s = store.settings();
    api.fetchMines(app.pos.lat, app.pos.lng, s.radiusM, force).then(function (res) {
      app.mines = res.mines;
      app.fetchedAt = res.fetchedAt;
      app.fetchCenter = res.center;
      app.truncated = res.truncated;
      app.mapDirty = true;
      recompute();
      renderAll();
      updateMap();
      if (res.truncated) toast('Der Bereich war zu gross — der Server hat gekuerzt. Kleineren Radius waehlen.', 'err');
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      var cached = api.loadCache();
      if (cached && cached.mines.length && !app.mines.length) {
        app.mines = cached.mines;
        app.fetchedAt = cached.fetchedAt;
        app.fetchCenter = cached.center;
        recompute(); renderAll(); updateMap();
        toast('Offline — zeige den letzten gespeicherten Stand.', 'err');
      } else {
        toast(err.message || 'Laden fehlgeschlagen.', 'err');
      }
    }).finally(function () {
      app.loading = false;
      $('btn-refresh').classList.remove('spin');
    });
  }

  function recompute() {
    var s = store.settings();
    app.groups = cluster.clusterMines(app.mines, s.linkM);
    app.targets = app.pos ? store.selectTargets(app.groups, app.pos, now(), s.maxTargets) : [];
  }

  // ── Rendern ───────────────────────────────────────────────────────────────
  function renderAll() {
    renderStatus();
    renderLocation();
    renderStreak();
    renderTarget();
    renderTargetList();
    renderCooldowns();
    renderOwners();
    renderHistory();
    $('btn-undo').hidden = !store.canUndo();
    if (store.canUndo()) $('btn-undo').title = 'Rueckgaengig: ' + store.undoLabel();
  }

  function renderStatus() {
    var gps = $('chip-gps');
    if (!app.pos) { gps.textContent = '📍 kein Standort'; gps.className = 'chip bad'; }
    else {
      gps.textContent = '📍 ' + (app.pos.source === 'gps' ? 'GPS' : 'manuell') +
        (app.pos.acc ? ' ±' + Math.round(app.pos.acc) + ' m' : '');
      gps.className = 'chip good';
    }
    $('chip-mines').textContent = '⛏ ' + app.mines.length + ' Minen';
    $('chip-mines').className = 'chip' + (app.truncated ? ' warn' : '');
    $('chip-groups').textContent = '👥 ' + app.groups.length + ' Gruppen';
    var age = $('chip-age');
    if (!app.fetchedAt) { age.textContent = '⟳ nie geladen'; age.className = 'chip'; }
    else {
      var mins = Math.floor((now() - app.fetchedAt) / 60000);
      age.textContent = '⟳ ' + (mins < 1 ? 'gerade eben' : 'vor ' + util.fmtDuration(mins * 60000));
      age.className = 'chip' + (mins > 30 ? ' warn' : '');
    }
  }

  function renderLocation() {
    $('my-coords').textContent = app.pos ? util.fmtCoord(app.pos.lat, app.pos.lng) : '–';
    $('my-accuracy').textContent = app.pos && app.pos.acc ? '±' + Math.round(app.pos.acc) + ' m' : '';
  }

  function renderStreak() {
    var st = store.stats(now());
    $('streak-count').textContent = st.todayCheckIns + ' Check-in' + (st.todayCheckIns === 1 ? '' : 's');
    var goal = st.nextMilestone ? st.nextMilestone.need : 10;
    $('streak-fill').style.width = Math.min(100, st.todayOwners / goal * 100) + '%';
    $('streak-text').innerHTML = st.nextMilestone
      ? '<b>' + st.todayOwners + '</b> verschiedene Owner heute — noch <b>' +
        (st.nextMilestone.need - st.todayOwners) + '</b> bis <b>+' + st.nextMilestone.bonus + ' TB</b> Streak-Bonus.'
      : '<b>' + st.todayOwners + '</b> verschiedene Owner heute — alle Streak-Stufen erreicht. 🔥';
  }

  function typeBadge(type) {
    var m = TYPE_META[type] || TYPE_META.rock;
    return '<span class="type-badge type-' + type + '">' + m.emoji + ' ' + m.name + '</span>';
  }

  function activeTarget() {
    if (!app.targets.length) return null;
    if (app.pinnedMineId) {
      for (var i = 0; i < app.targets.length; i++) if (app.targets[i].mine.id === app.pinnedMineId) return app.targets[i];
    }
    return app.targets[0];
  }

  function renderTarget() {
    var slot = $('target-slot');
    slot.innerHTML = '';
    var t = activeTarget();

    if (!app.pos) {
      slot.appendChild(el('div', 'card', '<div class="card-head"><h2>Los geht\'s</h2></div>' +
        '<p class="hint">Setz oben deinen Standort (GPS oder Koordinaten) — danach sucht der Radar automatisch die naechste Mine eines Owners, den du heute noch nicht hattest.</p>'));
      return;
    }
    if (!app.mines.length) {
      slot.appendChild(el('div', 'card', app.fetchedAt
        ? '<div class="card-head"><h2>Keine Minen in der Naehe</h2></div>' +
          '<p class="hint">Im Umkreis von ' + util.fmtDist(store.settings().radiusM) +
          ' ist kein einziges Feld vergeben. Erhoehe den Radius (Tab <b>Mehr</b>) oder such dir ueber die Karte ' +
          'eine Gegend mit Spielern.</p>'
        : '<div class="card-head"><h2>Keine Daten</h2></div>' +
          '<p class="hint">Noch keine Minen geladen. Tippe oben rechts auf ⟳.</p>'));
      return;
    }
    if (!t) {
      var free = app.groups.length;
      slot.appendChild(el('div', 'card', '<div class="card-head"><h2>Kein freier Owner</h2></div>' +
        '<p class="hint">Alle ' + free + ' Gruppen im Umkreis von ' + util.fmtDist(store.settings().radiusM) +
        ' sind im Cooldown, uebersprungen oder durch den Typfilter ausgeblendet. ' +
        'Erhoehe den Radius, lockere den Filter — oder schau unten, wann der naechste Owner frei wird.</p>'));
      return;
    }

    var m = t.mine;
    var g = t.group;
    var ownerHtml = t.ownerName
      ? '<span class="owner-tag">👤 ' + util.escapeHtml(t.ownerName) + '</span>'
      : '<span class="owner-tag new">✨ neuer Owner</span>';
    var lastSeen = '';
    if (t.ownerKey) {
      var o = store.owner(t.ownerKey);
      if (o && o.lastCheckInAt) lastSeen = ' <span class="muted">zuletzt vor ' + util.fmtDuration(now() - o.lastCheckInAt) + '</span>';
    }

    var card = el('div', 'target');
    card.innerHTML =
      '<div class="target-head"><span class="target-label">Naechstes Ziel</span>' + typeBadge(m.type) + '</div>' +
      '<button class="target-coords" id="btn-copy-coords">' +
        '<span><b>' + util.fmtCoord(m.lat, m.lng) + '</b>' +
        '<small>exakte Feldmitte · Raster ca. 11 m</small></span>' +
        '<span class="copy-hint">kopieren</span>' +
      '</button>' +
      '<div class="target-facts">' +
        '<div class="fact"><b>' + util.fmtDist(t.distance) + '</b><span>Entfernung</span></div>' +
        '<div class="fact"><b><span class="arrow" style="transform:rotate(' + Math.round(t.bearing) + 'deg)">↑</span> ' +
          util.compass(t.bearing) + '</b><span>Richtung</span></div>' +
        '<div class="fact"><b>' + g.size + '</b><span>Felder im Block</span></div>' +
        '<div class="fact"><b>' + t.freeCount + '</b><span>davon frei</span></div>' +
      '</div>' +
      '<div class="row gap wrap" style="margin-bottom:12px">' + ownerHtml + lastSeen + '</div>' +
      '<div class="target-actions">' +
        '<button class="btn block big" id="btn-checkin">✅ Check-in gemacht</button>' +
        '<a class="btn small ghost" id="btn-nav" href="' + navUrl(m) + '" target="_blank" rel="noopener">🧭 Navigation</a>' +
        '<button class="btn small ghost" id="btn-skip">⏭ Spaeter</button>' +
        '<button class="btn small ghost" id="btn-block">🚫 Nicht erreichbar</button>' +
      '</div>';
    slot.appendChild(card);

    $('btn-copy-coords').addEventListener('click', function () { copyCoords(m); });
    $('btn-checkin').addEventListener('click', function () { openCheckIn(t); });
    $('btn-skip').addEventListener('click', function () {
      store.snoozeGroup(g.id, store.settings().skipHours);
      app.pinnedMineId = null;
      afterChange('Gruppe fuer ' + store.settings().skipHours + ' h uebersprungen.');
    });
    $('btn-block').addEventListener('click', function () { openBlock(t); });
  }

  function navUrl(m) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + m.lat.toFixed(5) + ',' + m.lng.toFixed(5) + '&travelmode=walking';
  }

  function copyCoords(m) {
    var text = m.lat.toFixed(5) + ', ' + m.lng.toFixed(5);
    var done = function () { toast('Koordinaten kopiert: ' + text, 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Kopieren nicht moeglich: ' + text, 'err'); }
    document.body.removeChild(ta);
  }

  function renderTargetList() {
    var list = $('target-list');
    list.innerHTML = '';
    var t = activeTarget();
    var rest = app.targets.filter(function (x) { return !t || x.mine.id !== t.mine.id; });
    var routeMode = !!store.settings().routeOrder && !!t;
    $('btn-order').textContent = store.settings().routeOrder ? 'Route' : 'Entfernung';

    if (!rest.length) {
      $('next-count').textContent = '';
      list.appendChild(el('li', '', '<span class="empty">Keine weiteren freien Owner im Umkreis.</span>'));
      return;
    }

    var ordered = routeMode ? store.routeTargets(rest, t.mine) : rest;
    $('next-count').textContent = routeMode
      ? ordered.length + ' Owner · ' + util.fmtDist(ordered[ordered.length - 1].totalDistance) + ' Runde'
      : ordered.length + ' weitere Owner';

    ordered.forEach(function (x, i) {
      var li = el('li');
      li.innerHTML =
        '<span class="rank">' + (i + 2) + '</span>' +
        '<span class="info"><b>' + util.fmtCoord(x.mine.lat, x.mine.lng) + '</b>' +
        '<span>' + (TYPE_META[x.mine.type] || TYPE_META.rock).emoji + ' ' +
        (x.ownerName ? util.escapeHtml(x.ownerName) : 'neuer Owner') + ' · ' + felder(x.group.size) + '</span></span>' +
        (routeMode
          ? '<span class="dist">+' + util.fmtDist(x.legDistance) + '<small>' + util.fmtDist(x.totalDistance) + ' ab Ziel 1</small></span>'
          : '<span class="dist">' + util.fmtDist(x.distance) + ' ' + util.compass(x.bearing) + '</span>');
      li.addEventListener('click', function () {
        app.pinnedMineId = x.mine.id;
        renderTarget(); renderTargetList();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      list.appendChild(li);
    });
  }

  function renderCooldowns() {
    var list = $('cooldown-list');
    list.innerHTML = '';
    var n = now(), owners = store.owners(), rows = [];
    Object.keys(owners).forEach(function (k) {
      var until = store.ownerAvailableAt(k);
      if (until > n) rows.push({ o: owners[k], until: until });
    });
    rows.sort(function (a, b) { return a.until - b.until; });
    $('cooldown-count').textContent = rows.length ? rows.length + ' Owner' : '';
    if (!rows.length) {
      list.appendChild(el('li', '', '<span class="empty">Kein Owner im Cooldown.</span>'));
      return;
    }
    rows.slice(0, 12).forEach(function (r) {
      list.appendChild(el('li', '',
        '<span>👤 ' + util.escapeHtml(r.o.name) + '</span>' +
        '<span class="when">frei in ' + util.fmtDuration(r.until - n) + '</span>'));
    });
  }

  function renderOwners() {
    var list = $('owner-list');
    list.innerHTML = '';
    var n = now(), owners = store.owners();
    var keys = Object.keys(owners);
    var st = store.stats(n);
    $('owner-summary').textContent = keys.length + ' gesamt · ' + st.ownersOnCooldown + ' im Cooldown';
    if (!keys.length) {
      list.appendChild(el('li', '', '<span class="empty">Noch keine Owner erfasst. Hake dein erstes Ziel im Radar ab.</span>'));
      return;
    }
    keys.map(function (k) { return owners[k]; })
      .sort(function (a, b) { return (store.ownerAvailableAt(a.key) - store.ownerAvailableAt(b.key)) || (b.count - a.count); })
      .forEach(function (o) {
        var until = store.ownerAvailableAt(o.key);
        var free = until <= n;
        var li = el('li');
        li.innerHTML =
          '<div class="owner-row">' +
            '<span class="name">' + (o.anon ? '❔ ' : '👤 ') + util.escapeHtml(o.name) + '</span>' +
            '<span class="state ' + (free ? 'free' : 'cool') + '">' + (free ? 'frei' : 'in ' + util.fmtDuration(until - n)) + '</span>' +
          '</div>' +
          '<div class="muted">' + o.count + ' Check-in' + (o.count === 1 ? '' : 's') +
            (o.lastCheckInAt ? ' · zuletzt ' + util.fmtClock(o.lastCheckInAt) : '') + '</div>' +
          '<div class="owner-actions">' +
            '<button class="btn small ghost" data-act="rename">Name</button>' +
            (free ? '' : '<button class="btn small ghost" data-act="reset">Cooldown aufheben</button>') +
            '<button class="btn small danger" data-act="del">Loeschen</button>' +
          '</div>';
        li.querySelectorAll('button').forEach(function (b) {
          b.addEventListener('click', function () {
            var act = b.getAttribute('data-act');
            if (act === 'rename') {
              var name = window.prompt('Name des Owners (wie im Spiel angezeigt):', o.anon ? '' : o.name);
              if (name && name.trim()) { store.renameOwner(o.key, name); afterChange('Owner gespeichert.'); }
            } else if (act === 'reset') {
              store.resetOwnerCooldown(o.key);
              afterChange('Cooldown aufgehoben.');
            } else if (act === 'del') {
              if (window.confirm('„' + o.name + '“ wirklich loeschen? Der Cooldown und die Zuordnung gehen verloren.')) {
                store.deleteOwner(o.key);
                afterChange('Owner geloescht.');
              }
            }
          });
        });
        list.appendChild(li);
      });
  }

  function renderHistory() {
    var list = $('history-list');
    list.innerHTML = '';
    var checkIns = store.raw().checkIns;
    $('history-count').textContent = checkIns.length ? checkIns.length + ' gesamt' : '';
    if (!checkIns.length) {
      list.appendChild(el('li', '', '<span class="empty">Noch keine Check-ins gebucht.</span>'));
      return;
    }
    checkIns.slice(0, 25).forEach(function (c, i) {
      var o = store.owner(c.owner);
      var li = el('li', '',
        '<span>' + (TYPE_META[c.type] || TYPE_META.rock).emoji + ' ' +
        '<code>' + util.fmtCoord(c.lat, c.lng) + '</code> · ' +
        util.escapeHtml(o ? o.name : 'unbekannt') + '</span>' +
        '<span class="when">' + util.fmtClock(c.at) +
        ' <button class="btn small ghost" data-del="' + i + '" title="Check-in loeschen">✕</button></span>');
      li.querySelector('[data-del]').addEventListener('click', function () {
        if (!window.confirm('Diesen Check-in loeschen? Der Cooldown des Owners richtet sich danach nach dem vorherigen Eintrag.')) return;
        store.deleteCheckIn(i);
        afterChange('Check-in geloescht.');
      });
      list.appendChild(li);
    });
  }

  // ── Aktionen ──────────────────────────────────────────────────────────────
  function afterChange(msg) {
    recompute();
    renderAll();
    updateMap();
    if (msg) toast(msg, 'ok');
  }

  function openCheckIn(t) {
    var g = t.group, m = t.mine;
    openSheet('Check-in buchen', function (body) {
      var recent = Object.keys(store.owners()).map(function (k) { return store.owners()[k]; })
        .filter(function (o) { return !o.anon; })
        .sort(function (a, b) { return (b.lastCheckInAt || 0) - (a.lastCheckInAt || 0); })
        .slice(0, 6);

      body.innerHTML =
        '<p class="muted" style="margin-bottom:10px">' + typeBadge(m.type) + ' <code>' + util.fmtCoord(m.lat, m.lng) + '</code></p>' +
        '<div class="field"><span>Owner-Name <small class="muted">optional, aber empfohlen</small></span>' +
          '<input type="text" id="sheet-owner" placeholder="Name aus dem Spiel" value="' +
          (t.ownerName ? util.escapeHtml(t.ownerName) : '') + '" /></div>' +
        (recent.length ? '<div class="owner-suggest" id="sheet-suggest"></div>' : '') +
        (g.size >= 8 ? '<label class="switch-row"><input type="checkbox" id="sheet-multi" ' +
          ((store.groupRec(g.id) || {}).multiOwner ? 'checked' : '') + ' /> ' +
          '<span>Dieser Block gehoert mehreren Ownern (' + g.size + ' Felder) — dann sperrt der Check-in nur 30 m rundherum</span></label>' : '') +
        '<div class="sheet-buttons" style="margin-top:14px">' +
          '<button class="btn block" id="sheet-save">Check-in speichern</button>' +
          '<button class="btn ghost" id="sheet-anon">Ohne Namen</button>' +
          '<button class="btn ghost" id="sheet-cancel">Abbrechen</button>' +
        '</div>' +
        '<p class="hint">Der Name steht in der TerraMine-App auf dem Feld. Mit Namen erkennt der Radar auch andere Blocks derselben Person.</p>';

      if (recent.length) {
        var box = body.querySelector('#sheet-suggest');
        recent.forEach(function (o) {
          var b = el('button', '', util.escapeHtml(o.name));
          b.addEventListener('click', function () { body.querySelector('#sheet-owner').value = o.name; });
          box.appendChild(b);
        });
      }

      function commit(name) {
        var multiBox = body.querySelector('#sheet-multi');
        if (multiBox) store.setMultiOwner(g.id, multiBox.checked);
        var res = store.checkIn({ group: g, mine: m, ownerName: name }, now());
        closeSheet();
        app.pinnedMineId = null;
        recompute(); renderAll(); updateMap();
        var next = app.targets[0];
        toast('✅ ' + res.owner.name + ' gebucht — frei ab ' + util.fmtClock(res.at + store.cooldownMs()) +
          (next ? ' · naechstes Ziel ' + util.fmtDist(next.distance) + ' ' + util.compass(next.bearing) : ''), 'ok');
      }

      body.querySelector('#sheet-save').addEventListener('click', function () {
        commit(body.querySelector('#sheet-owner').value.trim());
      });
      body.querySelector('#sheet-anon').addEventListener('click', function () { commit(''); });
      body.querySelector('#sheet-cancel').addEventListener('click', closeSheet);
      setTimeout(function () { var i = body.querySelector('#sheet-owner'); if (i) i.focus(); }, 60);
    });
  }

  function openBlock(t) {
    var m = t.mine;
    openSheet('Mine sperren', function (body) {
      body.innerHTML =
        '<p class="muted" style="margin-bottom:12px">Nicht erreichbar (Privatgelaende, Gebaeude, Wasser)? Dann schlaegt der Radar <code>' +
        util.fmtCoord(m.lat, m.lng) + '</code> nicht mehr vor. Andere Felder desselben Owners bleiben nutzbar.</p>' +
        '<div class="sheet-buttons">' +
          '<button class="btn ghost" data-days="7">7 Tage</button>' +
          '<button class="btn ghost" data-days="30">30 Tage</button>' +
          '<button class="btn block" data-days="0">Dauerhaft sperren</button>' +
          '<button class="btn ghost" id="block-cancel" style="grid-column:1/-1">Abbrechen</button>' +
        '</div>';
      body.querySelectorAll('[data-days]').forEach(function (b) {
        b.addEventListener('click', function () {
          store.blockMine(m.id, parseInt(b.getAttribute('data-days'), 10), m.type);
          closeSheet();
          app.pinnedMineId = null;
          afterChange('Mine gesperrt.');
        });
      });
      body.querySelector('#block-cancel').addEventListener('click', closeSheet);
    });
  }

  // ── Karte (Leaflet wird erst beim Oeffnen geladen) ────────────────────────
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    return new Promise(function (resolve, reject) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
      var s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = function () { resolve(window.L); };
      s.onerror = function () { reject(new Error('Kartenbibliothek konnte nicht geladen werden (offline?)')); };
      document.head.appendChild(s);
    });
  }

  function initMap() {
    if (app.mapReady) return Promise.resolve();
    return loadLeaflet().then(function (L) {
      app.map = L.map('map', { zoomControl: true, attributionControl: true })
        .setView(app.pos ? [app.pos.lat, app.pos.lng] : [39.5, -98.35], app.pos ? 17 : 4);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Minen: terramine.app'
      }).addTo(app.map);
      app.mineLayer = L.layerGroup().addTo(app.map);
      app.mapReady = true;
      updateMap(true);
      updateMeOnMap();
    }).catch(function (e) {
      $('map-hint').textContent = e.message + ' Der Radar funktioniert auch ohne Karte.';
    });
  }

  function updateMeOnMap() {
    if (!app.mapReady || !app.pos) return;
    var L = window.L;
    if (app.meLayer) app.map.removeLayer(app.meLayer);
    if (app.radiusLayer) app.map.removeLayer(app.radiusLayer);
    app.meLayer = L.circleMarker([app.pos.lat, app.pos.lng], {
      radius: 7, color: '#4FC3F7', weight: 3, fillColor: '#4FC3F7', fillOpacity: .9
    }).addTo(app.map).bindPopup('Dein Standort');
    app.radiusLayer = L.circle([app.pos.lat, app.pos.lng], {
      radius: store.settings().radiusM, color: '#4FC3F7', weight: 1, opacity: .35, fill: false, dashArray: '4 6'
    }).addTo(app.map);
  }

  function updateMap(force) {
    if (!app.mapReady || (!app.mapDirty && !force)) return;
    var L = window.L, n = now();
    app.mineLayer.clearLayers();

    var targetIds = {};
    app.targets.forEach(function (t) { targetIds[t.mine.id] = true; });

    app.groups.forEach(function (g) {
      var gs = store.groupStatus(g, n);
      var freeIds = {};
      gs.freeMines.forEach(function (m) { freeIds[m.id] = 1; });

      g.mines.forEach(function (m) {
        var rec = store.mineRec(m.id);
        var color = '#8899AA', radius = 4, weight = 1;
        if (rec && rec.blockedUntil > n) color = '#FF6B6B';
        else if (gs.state === 'free' && freeIds[m.id]) { color = '#4CD98A'; radius = 5; }
        if (targetIds[m.id]) { color = '#FFD54F'; radius = 8; weight = 3; }

        var marker = L.circleMarker([m.lat, m.lng], {
          radius: radius, color: color, weight: weight, fillColor: color, fillOpacity: .65
        });
        // Popup-Inhalt erst beim Oeffnen berechnen — spart Arbeit bei vielen Minen.
        marker.bindPopup(function () { return minePopup(m, g, gs, store.mineStatus(m, g, Date.now())); });
        marker.on('popupopen', function (ev) { wirePopup(ev.popup, m, g); });
        app.mineLayer.addLayer(marker);
      });
    });
    app.mapDirty = false;
    if (force && app.pos) app.map.setView([app.pos.lat, app.pos.lng], 17);
  }

  function minePopup(m, g, gs, ms) {
    var ownerKey = (store.mineRec(m.id) || {}).owner || gs.ownerKeys[0];
    var o = ownerKey ? store.owner(ownerKey) : null;
    var status = ms.state === 'blocked' ? 'gesperrt'
      : gs.state === 'snoozed' ? 'uebersprungen bis ' + util.fmtClock(gs.until)
      : (ms.state === 'cooldown' || gs.state === 'cooldown')
        ? 'Cooldown noch ' + util.fmtDuration((ms.until || gs.until) - now())
        : 'frei';
    return '<b>' + util.fmtCoord(m.lat, m.lng) + '</b><br>' +
      (TYPE_META[m.type] || TYPE_META.rock).emoji + ' ' + (TYPE_META[m.type] || TYPE_META.rock).name +
      ' · Block: ' + felder(g.size) + '<br>' +
      '👤 ' + (o ? util.escapeHtml(o.name) : 'unbekannt') + ' · ' + status +
      '<div class="popup-actions">' +
        '<button class="btn small" data-pop="checkin">Check-in</button>' +
        '<button class="btn small ghost" data-pop="copy">Kopieren</button>' +
        '<button class="btn small ghost" data-pop="nav">Route</button>' +
      '</div>';
  }

  function wirePopup(popup, m, g) {
    var root = popup.getElement();
    if (!root) return;
    root.querySelectorAll('[data-pop]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-pop');
        if (act === 'copy') copyCoords(m);
        else if (act === 'nav') window.open(navUrl(m), '_blank', 'noopener');
        else {
          app.map.closePopup();
          var t = { mine: m, group: g, ownerName: store.ownerName(store.groupOwnerKeys(g)[0]) };
          openCheckIn(t);
        }
      });
    });
  }

  // ── Einstellungen / Tabs / Daten ──────────────────────────────────────────
  function syncSettingsUI() {
    var s = store.settings();
    $('rng-radius').value = s.radiusM;      $('lbl-radius').textContent = util.fmtDist(s.radiusM);
    $('rng-cooldown').value = s.cooldownH;  $('lbl-cooldown').textContent = s.cooldownH + ' h';
    $('rng-link').value = s.linkM;          $('lbl-link').textContent = s.linkM + ' m';
    $('chk-rare').checked = !!s.preferRare;
    document.querySelectorAll('[data-type]').forEach(function (c) {
      c.checked = s.types[c.getAttribute('data-type')] !== false;
    });
  }

  function switchView(name) {
    app.view = name;
    ['radar', 'map', 'owners', 'more'].forEach(function (v) { $('view-' + v).hidden = v !== name; });
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-view') === name);
    });
    if (name === 'map') initMap().then(function () { if (app.map) app.map.invalidateSize(); });
  }

  function exportData() {
    var blob = new Blob([store.exportJson()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'owner-radar-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Sicherung heruntergeladen.', 'ok');
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var mode = window.confirm('OK = mit dem aktuellen Stand zusammenfuehren\nAbbrechen = aktuellen Stand ersetzen') ? 'merge' : 'replace';
        store.importJson(String(reader.result), mode);
        afterChange('Daten importiert.');
      } catch (e) {
        toast('Datei konnte nicht gelesen werden: ' + e.message, 'err');
      }
    };
    reader.readAsText(file);
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  function wire() {
    $('btn-locate').addEventListener('click', locate);
    $('btn-refresh').addEventListener('click', function () { refresh(true); });
    $('btn-undo').addEventListener('click', function () {
      var label = store.undo();
      afterChange(label ? 'Rueckgaengig: ' + label : 'Nichts rueckgaengig zu machen.');
    });
    $('btn-manual').addEventListener('click', function () {
      var p = util.parseLatLng($('input-manual').value);
      if (!p) { toast('Koordinaten nicht erkannt. Beispiel: 52.52000, 13.40500', 'err'); return; }
      setPosition(p.lat, p.lng, null, 'manual');
      refresh();
    });
    $('input-manual').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btn-manual').click(); });
    $('chk-follow').addEventListener('change', function () { setFollow(this.checked); });

    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchView(t.getAttribute('data-view')); });
    });

    $('rng-radius').addEventListener('input', function () { $('lbl-radius').textContent = util.fmtDist(+this.value); });
    $('rng-radius').addEventListener('change', function () {
      store.setSettings({ radiusM: +this.value });
      syncSettingsUI(); updateMeOnMap(); refresh();
    });
    $('rng-cooldown').addEventListener('input', function () { $('lbl-cooldown').textContent = this.value + ' h'; });
    $('rng-cooldown').addEventListener('change', function () {
      store.setSettings({ cooldownH: +this.value });
      syncSettingsUI(); afterChange('Cooldown: ' + store.settings().cooldownH + ' h');
    });
    $('rng-link').addEventListener('input', function () { $('lbl-link').textContent = this.value + ' m'; });
    $('rng-link').addEventListener('change', function () {
      store.setSettings({ linkM: +this.value });
      syncSettingsUI(); app.mapDirty = true; afterChange('Blockabstand: ' + store.settings().linkM + ' m');
    });
    $('chk-rare').addEventListener('change', function () {
      store.setSettings({ preferRare: this.checked });
      afterChange(this.checked ? 'Seltene Minen bevorzugt.' : 'Rein nach Entfernung sortiert.');
    });
    document.querySelectorAll('[data-type]').forEach(function (c) {
      c.addEventListener('change', function () {
        var patch = {};
        patch[c.getAttribute('data-type')] = c.checked;
        store.setSettings({ types: patch });
        afterChange();
      });
    });

    $('btn-order').addEventListener('click', function () {
      var on = !store.settings().routeOrder;
      store.setSettings({ routeOrder: on });
      renderTargetList();
      toast(on ? 'Reihenfolge als Laufroute.' : 'Reihenfolge nach Luftlinie.', 'ok');
    });

    $('btn-export').addEventListener('click', exportData);
    $('btn-import').addEventListener('click', function () { $('file-import').click(); });
    $('file-import').addEventListener('change', function () { if (this.files[0]) importData(this.files[0]); this.value = ''; });
    $('btn-reset').addEventListener('click', function () {
      if (window.confirm('Wirklich alle Owner, Cooldowns und Check-ins loeschen?')) {
        store.reset();
        afterChange('Alles zurueckgesetzt.');
      }
    });

    $('btn-search-here').addEventListener('click', function () {
      if (!app.map) return;
      var c = app.map.getCenter();
      setPosition(c.lat, c.lng, null, 'manual');
      refresh();
    });

    $('sheet-backdrop').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

    window.addEventListener('online', function () { toast('Wieder online.', 'ok'); refresh(); });
  }

  function start() {
    wire();
    syncSettingsUI();
    restorePosition();

    var cached = api.loadCache();
    if (cached && cached.mines.length) {
      app.mines = cached.mines;
      app.fetchedAt = cached.fetchedAt;
      app.fetchCenter = cached.center;
    }
    recompute();
    renderAll();

    if (app.pos) refresh();

    // Cooldown-Restzeiten und Datenalter laufen mit.
    setInterval(function () {
      renderStatus();
      renderCooldowns();
      if (app.view === 'owners') renderOwners();
      var before = app.targets.length;
      recompute();
      if (app.targets.length !== before) { renderTarget(); renderTargetList(); app.mapDirty = true; updateMap(); }
    }, 30000);

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
