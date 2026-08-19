/* Owner Radar — UI.
   Core logic lives in store.js / cluster.js / world.js (see tests/run.js).
   All user-facing text goes through TM.i18n (English default, German switchable). */
(function () {
  'use strict';

  var util = TM.util, cluster = TM.cluster, api = TM.api, i18n = TM.i18n;
  var t = i18n.t;
  var store = TM.store.createStore(window.localStorage);
  var POS_KEY = 'terramine-owner-radar:pos';
  var SPOT_KEY = 'terramine-owner-radar:spot';

  var TYPE_META = {
    rock:    { emoji: '🪨', key: 'settings.rock' },
    coal:    { emoji: '⚫', key: 'settings.coal' },
    gold:    { emoji: '⭐', key: 'settings.gold' },
    diamond: { emoji: '💎', key: 'settings.diamond' }
  };

  var app = {
    pos: null,            // { lat, lng, acc, at, source } — own location
    worldPoint: null,     // centre of the current random spot
    worldCell: null,      // matching cell from the world overview
    rolling: false,
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
  function mode() { return store.settings().mode === 'world' ? 'world' : 'near'; }
  /* Reference point for distances, search and route. */
  function origin() { return mode() === 'world' ? app.worldPoint : app.pos; }
  function tiles(n) { return n === 1 ? t('list.fieldsOne') : t('list.fields', { n: n }); }
  function typeName(type) { return t((TYPE_META[type] || TYPE_META.rock).key).replace(/^\S+\s/, ''); }

  // ── Toast / sheet ─────────────────────────────────────────────────────────
  var toastTimer = null;
  function toast(msg, kind) {
    var n = $('toast');
    n.className = 'toast ' + (kind || '');
    n.textContent = msg;
    n.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.hidden = true; }, kind === 'err' ? 6000 : 3400);
  }

  function openSheet(title, buildBody) {
    $('sheet-title').textContent = title;
    var body = $('sheet-body');
    body.innerHTML = '';
    buildBody(body);
    $('sheet-backdrop').hidden = false;
  }
  function closeSheet() { $('sheet-backdrop').hidden = true; }

  // ── Location ──────────────────────────────────────────────────────────────
  function setPosition(lat, lng, acc, source) {
    app.pos = { lat: lat, lng: lng, acc: acc == null ? null : acc, at: now(), source: source || 'manual' };
    try { localStorage.setItem(POS_KEY, JSON.stringify(app.pos)); } catch (e) {}
    maybeAutoRefresh();
    recompute();
    renderAll();
    updateMeOnMap();
  }

  function saveWorldSpot() {
    try { localStorage.setItem(SPOT_KEY, JSON.stringify(app.worldCell || null)); } catch (e) {}
  }

  function restoreWorldSpot() {
    try {
      var c = JSON.parse(localStorage.getItem(SPOT_KEY) || 'null');
      if (c && isFinite(c.lat) && isFinite(c.lng)) {
        app.worldCell = c;
        app.worldPoint = { lat: c.lat, lng: c.lng };
      }
    } catch (e) {}
  }

  function restorePosition() {
    try {
      var p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (p && isFinite(p.lat) && isFinite(p.lng)) app.pos = p;
    } catch (e) {}
  }

  function geoError(err) {
    var msg = t('geo.unavailable');
    if (err && err.code === 1) msg = t('geo.denied');
    else if (err && err.code === 2) msg = t('geo.position');
    else if (err && err.code === 3) msg = t('geo.timeout');
    toast(msg, 'err');
  }

  function locate() {
    if (!navigator.geolocation) { toast(t('geo.unsupported'), 'err'); return; }
    var btn = $('btn-locate');
    btn.disabled = true;
    btn.textContent = '…';
    navigator.geolocation.getCurrentPosition(function (p) {
      btn.disabled = false;
      btn.textContent = t('loc.gps');
      setPosition(p.coords.latitude, p.coords.longitude, p.coords.accuracy, 'gps');
      refresh();
    }, function (e) {
      btn.disabled = false;
      btn.textContent = t('loc.gps');
      geoError(e);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 });
  }

  function setFollow(on) {
    if (on) {
      if (!navigator.geolocation) { toast(t('geo.unsupported'), 'err'); $('chk-follow').checked = false; return; }
      app.watchId = navigator.geolocation.watchPosition(function (p) {
        setPosition(p.coords.latitude, p.coords.longitude, p.coords.accuracy, 'gps');
      }, geoError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 25000 });
    } else if (app.watchId != null) {
      navigator.geolocation.clearWatch(app.watchId);
      app.watchId = null;
    }
  }

  // ── Loading mines ─────────────────────────────────────────────────────────
  function maybeAutoRefresh() {
    if (mode() === 'world') return;      // in world mode the rolled spot counts, not your movement
    if (!app.pos || app.loading) return;
    if (!app.fetchCenter) return;
    var moved = util.distance(app.pos.lat, app.pos.lng, app.fetchCenter.lat, app.fetchCenter.lng);
    var s = store.settings();
    // Reload as soon as the old radius no longer covers the current position well.
    if (moved > Math.max(250, s.radiusM * 0.35)) refresh();
  }

  function refresh(force) {
    var from = origin();
    if (!from) {
      toast(mode() === 'world' ? t('world.needSpot') : t('toast.needLocation'), 'err');
      return;
    }
    if (app.loading) return;
    app.loading = true;
    $('btn-refresh').classList.add('spin');
    var s = store.settings();
    var req = mode() === 'world' && app.worldCell
      ? api.fetchMinesInBounds(TM.world.cellBbox(app.worldCell), { center: from }, force)
      : api.fetchMines(from.lat, from.lng, s.radiusM, force);

    return req.then(function (res) {
      app.mines = res.mines;
      app.fetchedAt = res.fetchedAt;
      app.fetchCenter = res.center;
      app.truncated = res.truncated;
      app.mapDirty = true;
      recompute();
      renderAll();
      updateMap();
      if (res.truncated) toast(t('toast.truncated'), 'err');
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      var cached = api.loadCache();
      if (cached && cached.mines.length && !app.mines.length) {
        app.mines = cached.mines;
        app.fetchedAt = cached.fetchedAt;
        app.fetchCenter = cached.center;
        recompute(); renderAll(); updateMap();
        toast(t('toast.offline'), 'err');
      } else {
        toast(err.message || t('toast.loadFail'), 'err');
      }
    }).finally(function () {
      app.loading = false;
      $('btn-refresh').classList.remove('spin');
    });
  }

  function recompute() {
    var s = store.settings();
    var from = origin();
    app.groups = cluster.clusterMines(app.mines, s.linkM);
    app.targets = from ? store.selectTargets(app.groups, from, now(), s.maxTargets) : [];
  }

  // ── World mode ────────────────────────────────────────────────────────────
  function setMode(m) {
    store.setSettings({ mode: m });
    document.querySelectorAll('#mode-switch .seg').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === m);
    });
    $('card-near').hidden = m !== 'near';
    $('card-world').hidden = m === 'near';

    // The loaded mines belong to the previous reference point — reload cleanly.
    app.mines = [];
    app.fetchedAt = 0;
    app.mapDirty = true;
    recompute();
    renderAll();
    updateMap();
    if (origin()) refresh(true);
  }

  /* Make sure the world overview is available — first time with a prompt and progress. */
  function ensureWorldData() {
    if (api.hasWorldCache()) return api.fetchWorldCells();
    return new Promise(function (resolve, reject) {
      openSheet(t('sheet.worldTitle'), function (body) {
        body.innerHTML =
          '<p class="muted" style="margin-bottom:12px">' + t('sheet.worldText') + '</p>' +
          '<div class="progress" id="dl-wrap" hidden><div id="dl-bar"></div></div>' +
          '<p class="hint" id="dl-text" hidden>' + t('sheet.worldLoading') + '</p>' +
          '<div class="sheet-buttons" style="margin-top:14px">' +
            '<button class="btn block" id="dl-start">' + t('sheet.worldStart') + '</button>' +
            '<button class="btn ghost" id="dl-cancel" style="grid-column:1/-1">' + t('sheet.cancel') + '</button>' +
          '</div>';

        body.querySelector('#dl-cancel').addEventListener('click', function () {
          closeSheet();
          reject(new Error(t('sheet.cancelled')));
        });
        body.querySelector('#dl-start').addEventListener('click', function () {
          var btn = body.querySelector('#dl-start');
          btn.disabled = true;
          btn.textContent = t('sheet.worldLoading');
          body.querySelector('#dl-wrap').hidden = false;
          body.querySelector('#dl-text').hidden = false;
          api.fetchWorldCells({
            onProgress: function (loaded, total) {
              var bar = body.querySelector('#dl-bar');
              var txt = body.querySelector('#dl-text');
              if (!bar || !txt) return;
              var mb = fmtMb(loaded);
              if (total) bar.style.width = Math.min(100, loaded / total * 100) + '%';
              txt.textContent = total
                ? t('sheet.worldProgressOf', { mb: mb, total: fmtMb(total) })
                : t('sheet.worldProgress', { mb: mb });
            }
          }).then(function (data) {
            closeSheet();
            resolve(data);
          }).catch(function (err) {
            closeSheet();
            reject(err);
          });
        });
      });
    });
  }

  function fmtMb(bytes) {
    var v = (bytes / 1048576).toFixed(1);
    return util.getLocale() === 'de' ? v.replace('.', ',') : v;
  }

  function updateDiceUI(text) {
    var b = $('btn-dice');
    b.disabled = app.rolling;
    b.textContent = text || (app.rolling
      ? t('world.searchingShort')
      : (app.worldCell ? t('world.diceNext') : t('world.dice')));
  }

  /* Roll a random spot. If no free owner is there, keep rolling automatically —
     so a usable target always comes back. */
  function rollRandom() {
    if (app.rolling) return Promise.resolve();
    app.rolling = true;
    updateDiceUI();

    var maxTries = 6;

    function attempt(n) {
      var s = store.settings();
      return api.fetchWorldCells().then(function (data) {
        var pick = TM.world.pickCell(data.cells, {
          minMines: s.worldMinMines,
          requireType: s.worldRequireType,
          exclude: store.visitedCells()
        });
        if (!pick) throw new Error(t('world.noCell'));

        app.worldCell = pick.cell;
        app.worldPoint = { lat: pick.cell.lat, lng: pick.cell.lng };
        store.markCellVisited(TM.world.cellKey(pick.cell));
        saveWorldSpot();
        updateDiceUI(t('world.searching', { n: n, max: maxTries }));

        return api.fetchMinesInBounds(TM.world.cellBbox(pick.cell), { center: app.worldPoint }, false)
          .then(function (res) {
            app.mines = res.mines;
            app.fetchedAt = res.fetchedAt;
            app.fetchCenter = res.center;
            app.truncated = res.truncated;
            app.mapDirty = true;
            app.pinnedMineId = null;
            recompute();
            if (!app.targets.length && n < maxTries) return attempt(n + 1);
            return null;
          });
      });
    }

    return ensureWorldData()
      .then(function () { return attempt(1); })
      .then(function () {
        renderAll();
        updateMap();
        if (app.mapReady && app.worldPoint) app.map.setView([app.worldPoint.lat, app.worldPoint.lng], 16);
        var target = app.targets[0];
        toast(target
          ? t('world.rolled', { n: app.mines.length, dist: util.fmtDist(target.distance) })
          : t('world.noFree'), target ? 'ok' : 'err');
      })
      .catch(function (err) {
        if (err && err.message !== t('sheet.cancelled')) toast(err.message || t('world.failed'), 'err');
      })
      .finally(function () {
        app.rolling = false;
        updateDiceUI();
        renderWorldCard();
      });
  }

  function renderWorldCard() {
    var s = store.settings();
    $('rng-world-min').value = s.worldMinMines;
    $('lbl-world-min').textContent = t('world.minMines', { n: s.worldMinMines });
    document.querySelectorAll('#world-type-filters [data-wtype]').forEach(function (b) {
      b.classList.toggle('sel', b.getAttribute('data-wtype') === s.worldRequireType);
    });
    var visited = Object.keys(store.visitedCells()).length;
    $('world-status').textContent = visited
      ? (visited === 1 ? t('world.visitedOne') : t('world.visited', { n: visited }))
      : '';
    updateDiceUI();

    var info = $('world-info');
    if (!app.worldCell) { info.hidden = true; return; }
    info.hidden = false;

    // Once loaded the real mines count, before that the world overview estimate.
    var meta;
    if (app.mines.length) {
      var c = { rock: 0, coal: 0, gold: 0, diamond: 0 };
      app.mines.forEach(function (m) { if (c[m.type] != null) c[m.type]++; });
      meta = t('world.loadedMines', { n: app.mines.length, types: TM.world.describeCell(c) });
    } else {
      meta = t('world.estimate', {
        n: TM.world.cellTotal(app.worldCell),
        types: TM.world.describeCell(app.worldCell)
      });
    }

    info.innerHTML =
      '<div class="row gap"><code>' + util.fmtCoord(app.worldCell.lat, app.worldCell.lng) + '</code>' +
      '<button class="copy-btn" id="btn-copy-spot" title="' + util.escapeHtml(t('world.copySpot')) + '">📋</button></div>' +
      '<div class="world-meta">' + meta + '</div>';
    $('btn-copy-spot').addEventListener('click', function () {
      copyText(util.fmtCoord(app.worldCell.lat, app.worldCell.lng), this);
    });
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function renderAll() {
    renderStatus();
    renderLocation();
    renderWorldCard();
    renderStreak();
    renderTarget();
    renderTargetList();
    renderCooldowns();
    renderOwners();
    renderHistory();
    var undo = store.undoLabel();
    $('btn-undo').hidden = !undo;
    if (undo) $('btn-undo').title = t('toast.undone', { label: undoText(undo) });
  }

  function undoText(entry) {
    if (!entry) return '';
    if (entry.key === 'undo.checkin') {
      return t('undo.checkin', {
        name: entry.params && entry.params.name
          ? entry.params.name
          : t('undo.mine', { id: (entry.params && entry.params.mineId) || '' })
      });
    }
    return t(entry.key, entry.params);
  }

  function renderStatus() {
    var gps = $('chip-gps');
    if (mode() === 'world') {
      gps.textContent = app.worldPoint
        ? '🎲 ' + util.fmtCoord(app.worldPoint.lat, app.worldPoint.lng)
        : t('chip.notRolled');
      gps.className = 'chip' + (app.worldPoint ? ' good' : ' bad');
    } else if (!app.pos) {
      gps.textContent = t('chip.noLocation');
      gps.className = 'chip bad';
    } else {
      gps.textContent = (app.pos.source === 'gps' ? t('chip.gps') : t('chip.manual')) +
        (app.pos.acc ? ' ±' + Math.round(app.pos.acc) + ' m' : '');
      gps.className = 'chip good';
    }
    $('chip-mines').textContent = t('chip.mines', { n: app.mines.length });
    $('chip-mines').className = 'chip' + (app.truncated ? ' warn' : '');
    $('chip-groups').textContent = t('chip.groups', { n: app.groups.length });

    var age = $('chip-age');
    if (!app.fetchedAt) { age.textContent = t('chip.never'); age.className = 'chip'; }
    else {
      var mins = Math.floor((now() - app.fetchedAt) / 60000);
      age.textContent = mins < 1 ? t('chip.justNow') : t('chip.ago', { t: util.fmtDuration(mins * 60000) });
      age.className = 'chip' + (mins > 30 ? ' warn' : '');
    }
  }

  function renderLocation() {
    $('my-coords').textContent = app.pos ? util.fmtCoord(app.pos.lat, app.pos.lng) : '–';
    $('my-accuracy').textContent = app.pos && app.pos.acc ? '±' + Math.round(app.pos.acc) + ' m' : '';
  }

  function renderStreak() {
    var st = store.stats(now());
    $('streak-count').textContent = st.todayCheckIns === 1
      ? t('today.checkInsOne')
      : t('today.checkIns', { n: st.todayCheckIns });
    var goal = st.nextMilestone ? st.nextMilestone.need : 10;
    $('streak-fill').style.width = Math.min(100, st.todayOwners / goal * 100) + '%';
    if (!st.todayCheckIns) {
      $('streak-text').textContent = t('today.none');
    } else {
      $('streak-text').innerHTML = st.nextMilestone
        ? t('today.streak', {
            owners: st.todayOwners,
            missing: st.nextMilestone.need - st.todayOwners,
            bonus: st.nextMilestone.bonus
          })
        : t('today.streakDone', { owners: st.todayOwners });
    }
  }

  function typeBadge(type) {
    var m = TYPE_META[type] || TYPE_META.rock;
    return '<span class="type-badge type-' + type + '">' + t(m.key) + '</span>';
  }

  function activeTarget() {
    if (!app.targets.length) return null;
    if (app.pinnedMineId) {
      for (var i = 0; i < app.targets.length; i++) if (app.targets[i].mine.id === app.pinnedMineId) return app.targets[i];
    }
    return app.targets[0];
  }

  function infoCard(title, html) {
    return el('div', 'card', '<div class="card-head"><h2>' + util.escapeHtml(title) + '</h2></div>' +
      '<p class="hint">' + html + '</p>');
  }

  function renderTarget() {
    var slot = $('target-slot');
    slot.innerHTML = '';
    var target = activeTarget();
    var world = mode() === 'world';

    if (world && !app.worldPoint) {
      slot.appendChild(infoCard(t('empty.rollTitle'), t('empty.rollText', { h: store.settings().cooldownH })));
      return;
    }
    if (!world && !app.pos) {
      slot.appendChild(infoCard(t('empty.startTitle'), t('empty.startText')));
      return;
    }
    if (!app.mines.length) {
      slot.appendChild(app.fetchedAt
        ? infoCard(t('empty.noMinesTitle'), world
            ? t('empty.noMinesWorld')
            : t('empty.noMinesNear', { r: util.fmtDist(store.settings().radiusM) }))
        : infoCard(t('empty.noDataTitle'), t('empty.noDataText')));
      return;
    }
    if (!target) {
      slot.appendChild(infoCard(t('empty.noFreeTitle'),
        t('empty.noFreeText', { n: app.groups.length }) +
        (world ? t('empty.noFreeWorld') : t('empty.noFreeNear'))));
      return;
    }

    var m = target.mine;
    var g = target.group;
    var ownerHtml = target.ownerName
      ? '<span class="owner-tag">👤 ' + util.escapeHtml(target.ownerName) + '</span>'
      : '<span class="owner-tag new">' + t('target.newOwner') + '</span>';
    var lastSeen = '';
    if (target.ownerKey) {
      var o = store.owner(target.ownerKey);
      if (o && o.lastCheckInAt) {
        lastSeen = ' <span class="muted">' + t('target.lastSeen', { t: util.fmtDuration(now() - o.lastCheckInAt) }) + '</span>';
      }
    }

    var card = el('div', 'target');
    card.innerHTML =
      '<div class="target-head"><span class="target-label">' + t('target.label') + '</span>' + typeBadge(m.type) + '</div>' +
      '<button class="target-coords" id="btn-copy-coords">' +
        '<b>' + util.fmtCoord(m.lat, m.lng) + '</b>' +
        '<span class="coords-sub"><small>' + t('target.coordsSub') + '</small>' +
        '<span class="copy-hint">' + t('target.copyHint') + '</span></span>' +
      '</button>' +
      '<div class="target-facts">' +
        '<div class="fact"><b>' + util.fmtDist(target.distance) + '</b><span>' +
          (world ? t('target.distanceWorld') : t('target.distance')) + '</span></div>' +
        '<div class="fact"><b><span class="arrow" style="transform:rotate(' + Math.round(target.bearing) + 'deg)">↑</span> ' +
          util.compass(target.bearing) + '</b><span>' + t('target.direction') + '</span></div>' +
        '<div class="fact"><b>' + g.size + '</b><span>' + t('target.blockFields') + '</span></div>' +
        '<div class="fact"><b>' + target.freeCount + '</b><span>' + t('target.freeFields') + '</span></div>' +
      '</div>' +
      '<div class="row gap wrap" style="margin-bottom:12px">' + ownerHtml + lastSeen + '</div>' +
      '<div class="target-actions">' +
        '<button class="btn big block" id="btn-checkin">' + t('target.checkin') + '</button>' +
        '<button class="btn ghost" id="btn-copy-btn">' + t('target.copy') + '</button>' +
        '<a class="btn ghost" id="btn-nav" href="' + navUrl(m) + '" target="_blank" rel="noopener">' + t('target.map') + '</a>' +
        '<button class="btn small ghost" id="btn-skip">' + t('target.later') + '</button>' +
        '<button class="btn small ghost" id="btn-block">' + t('target.blocked') + '</button>' +
      '</div>';
    slot.appendChild(card);

    $('btn-copy-coords').addEventListener('click', function () { copyCoords(m, this); });
    $('btn-copy-btn').addEventListener('click', function () { copyCoords(m, this); });
    $('btn-checkin').addEventListener('click', function () { openCheckIn(target); });
    $('btn-skip').addEventListener('click', function () {
      store.snoozeGroup(g.id, store.settings().skipHours);
      app.pinnedMineId = null;
      afterChange(t('toast.skipped', { h: store.settings().skipHours }));
    });
    $('btn-block').addEventListener('click', function () { openBlock(target); });
  }

  function navUrl(m) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' +
      m.lat.toFixed(5) + ',' + m.lng.toFixed(5) + '&travelmode=walking';
  }

  function copyCoords(m, btn) {
    copyText(m.lat.toFixed(5) + ', ' + m.lng.toFixed(5), btn);
  }

  /* One tap = coordinates in the clipboard, with visible and tactile feedback
     (the single most important action on a phone). */
  function copyText(text, btn) {
    function done() {
      if (navigator.vibrate) { try { navigator.vibrate(25); } catch (e) {} }
      if (btn) {
        btn.classList.add('copied');
        var hint = btn.querySelector('.copy-hint');
        var prev = hint ? hint.textContent : null;
        if (hint) hint.textContent = t('target.copied');
        setTimeout(function () {
          btn.classList.remove('copied');
          if (hint && prev) hint.textContent = prev;
        }, 1600);
      }
      toast(t('toast.copied', { text: text }), 'ok');
    }
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
    try { document.execCommand('copy'); done(); }
    catch (e) { toast(t('toast.copyFail', { text: text }), 'err'); }
    document.body.removeChild(ta);
  }

  function renderTargetList() {
    var list = $('target-list');
    list.innerHTML = '';
    var target = activeTarget();
    var rest = app.targets.filter(function (x) { return !target || x.mine.id !== target.mine.id; });
    var routeMode = !!store.settings().routeOrder && !!target;
    $('btn-order').textContent = store.settings().routeOrder ? t('list.orderRoute') : t('list.orderDistance');

    if (!rest.length) {
      $('next-count').textContent = '';
      list.appendChild(el('li', '', '<span class="empty">' + t('list.none') + '</span>'));
      return;
    }

    var ordered = routeMode ? store.routeTargets(rest, target.mine) : rest;
    $('next-count').textContent = routeMode
      ? t('list.routeSummary', { n: ordered.length, dist: util.fmtDist(ordered[ordered.length - 1].totalDistance) })
      : t('list.moreOwners', { n: ordered.length });

    ordered.forEach(function (x, i) {
      var li = el('li');
      li.innerHTML =
        '<span class="rank">' + (i + 2) + '</span>' +
        '<span class="info"><b>' + util.fmtCoord(x.mine.lat, x.mine.lng) + '</b>' +
        '<span>' + (TYPE_META[x.mine.type] || TYPE_META.rock).emoji + ' ' +
        (x.ownerName ? util.escapeHtml(x.ownerName) : t('target.newOwner').replace('✨ ', '')) +
        ' · ' + tiles(x.group.size) + '</span></span>' +
        (routeMode
          ? '<span class="dist">+' + util.fmtDist(x.legDistance) +
            '<small>' + t('list.fromFirst', { dist: util.fmtDist(x.totalDistance) }) + '</small></span>'
          : '<span class="dist">' + util.fmtDist(x.distance) + ' ' + util.compass(x.bearing) + '</span>') +
        '<button class="copy-btn" title="' + util.escapeHtml(t('list.copy')) + '">📋</button>';
      li.querySelector('.copy-btn').addEventListener('click', function (ev) {
        ev.stopPropagation();
        copyCoords(x.mine, this);
      });
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
    $('cooldown-count').textContent = rows.length
      ? (rows.length === 1 ? t('cooldown.countOne') : t('cooldown.count', { n: rows.length }))
      : '';
    if (!rows.length) {
      list.appendChild(el('li', '', '<span class="empty">' + t('cooldown.none') + '</span>'));
      return;
    }
    rows.slice(0, 12).forEach(function (r) {
      list.appendChild(el('li', '',
        '<span>👤 ' + util.escapeHtml(r.o.name) + '</span>' +
        '<span class="when">' + t('cooldown.freeIn', { t: util.fmtDuration(r.until - n) }) + '</span>'));
    });
  }

  function renderOwners() {
    var list = $('owner-list');
    list.innerHTML = '';
    var n = now(), owners = store.owners();
    var keys = Object.keys(owners);
    var st = store.stats(n);
    $('owner-summary').textContent = t('owners.summary', { total: keys.length, cool: st.ownersOnCooldown });
    if (!keys.length) {
      list.appendChild(el('li', '', '<span class="empty">' + t('owners.none') + '</span>'));
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
            '<span class="state ' + (free ? 'free' : 'cool') + '">' +
              (free ? t('owners.free') : t('owners.in', { t: util.fmtDuration(until - n) })) + '</span>' +
          '</div>' +
          '<div class="muted">' +
            (o.count === 1 ? t('owners.checkInsOne') : t('owners.checkIns', { n: o.count })) +
            (o.lastCheckInAt ? ' · ' + t('owners.last', { t: util.fmtClock(o.lastCheckInAt) }) : '') + '</div>' +
          '<div class="owner-actions">' +
            '<button class="btn small ghost" data-act="rename">' + t('owners.rename') + '</button>' +
            (free ? '' : '<button class="btn small ghost" data-act="reset">' + t('owners.resetCooldown') + '</button>') +
            '<button class="btn small danger" data-act="del">' + t('owners.delete') + '</button>' +
          '</div>';
        li.querySelectorAll('button').forEach(function (b) {
          b.addEventListener('click', function () {
            var act = b.getAttribute('data-act');
            if (act === 'rename') {
              var name = window.prompt(t('owners.renamePrompt'), o.anon ? '' : o.name);
              if (name && name.trim()) { store.renameOwner(o.key, name); afterChange(t('owners.saved')); }
            } else if (act === 'reset') {
              store.resetOwnerCooldown(o.key);
              afterChange(t('owners.cooldownCleared'));
            } else if (act === 'del') {
              if (window.confirm(t('owners.deleteConfirm', { name: o.name }))) {
                store.deleteOwner(o.key);
                afterChange(t('owners.deleted'));
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
    $('history-count').textContent = checkIns.length ? t('history.count', { n: checkIns.length }) : '';
    if (!checkIns.length) {
      list.appendChild(el('li', '', '<span class="empty">' + t('history.none') + '</span>'));
      return;
    }
    checkIns.slice(0, 25).forEach(function (c, i) {
      var o = store.owner(c.owner);
      var li = el('li', '',
        '<span>' + (TYPE_META[c.type] || TYPE_META.rock).emoji + ' ' +
        '<code>' + util.fmtCoord(c.lat, c.lng) + '</code> · ' +
        util.escapeHtml(o ? o.name : t('history.unknown')) + '</span>' +
        '<span class="when">' + util.fmtClock(c.at) +
        ' <button class="btn small ghost" data-del="' + i + '" title="' + util.escapeHtml(t('history.delete')) + '">✕</button></span>');
      li.querySelector('[data-del]').addEventListener('click', function () {
        if (!window.confirm(t('history.deleteConfirm'))) return;
        store.deleteCheckIn(i);
        afterChange(t('history.deleted'));
      });
      list.appendChild(li);
    });
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  function afterChange(msg) {
    recompute();
    renderAll();
    updateMap();
    if (msg) toast(msg, 'ok');
  }

  function openCheckIn(target) {
    var g = target.group, m = target.mine;
    openSheet(t('sheet.checkinTitle'), function (body) {
      var recent = Object.keys(store.owners()).map(function (k) { return store.owners()[k]; })
        .filter(function (o) { return !o.anon; })
        .sort(function (a, b) { return (b.lastCheckInAt || 0) - (a.lastCheckInAt || 0); })
        .slice(0, 6);

      body.innerHTML =
        '<p class="muted" style="margin-bottom:10px">' + typeBadge(m.type) +
          ' <code>' + util.fmtCoord(m.lat, m.lng) + '</code></p>' +
        '<div class="field"><span>' + t('sheet.ownerName') +
          ' <small class="muted">' + t('sheet.ownerOptional') + '</small></span>' +
          '<input type="text" id="sheet-owner" placeholder="' + util.escapeHtml(t('sheet.namePlaceholder')) + '" value="' +
          (target.ownerName ? util.escapeHtml(target.ownerName) : '') + '" /></div>' +
        (recent.length ? '<div class="owner-suggest" id="sheet-suggest"></div>' : '') +
        (g.size >= 8 ? '<label class="switch-row"><input type="checkbox" id="sheet-multi" ' +
          ((store.groupRec(g.id) || {}).multiOwner ? 'checked' : '') + ' /> ' +
          '<span>' + t('sheet.multiOwner', { n: g.size }) + '</span></label>' : '') +
        '<div class="sheet-buttons" style="margin-top:14px">' +
          '<button class="btn block" id="sheet-save">' + t('sheet.save') + '</button>' +
          '<button class="btn ghost" id="sheet-anon">' + t('sheet.anon') + '</button>' +
          '<button class="btn ghost" id="sheet-cancel">' + t('sheet.cancel') + '</button>' +
        '</div>' +
        '<p class="hint">' + t('sheet.checkinHint') + '</p>';

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
        toast(t('sheet.booked', { name: res.owner.name, time: util.fmtClock(res.at + store.cooldownMs()) }) +
          (next ? t('sheet.bookedNext', { dist: util.fmtDist(next.distance), dir: util.compass(next.bearing) }) : ''), 'ok');
      }

      body.querySelector('#sheet-save').addEventListener('click', function () {
        commit(body.querySelector('#sheet-owner').value.trim());
      });
      body.querySelector('#sheet-anon').addEventListener('click', function () { commit(''); });
      body.querySelector('#sheet-cancel').addEventListener('click', closeSheet);
      setTimeout(function () { var i = body.querySelector('#sheet-owner'); if (i) i.focus(); }, 60);
    });
  }

  function openBlock(target) {
    var m = target.mine;
    openSheet(t('sheet.blockTitle'), function (body) {
      body.innerHTML =
        '<p class="muted" style="margin-bottom:12px">' +
          t('sheet.blockText', { coords: util.fmtCoord(m.lat, m.lng) }) + '</p>' +
        '<div class="sheet-buttons">' +
          '<button class="btn ghost" data-days="7">' + t('sheet.block7') + '</button>' +
          '<button class="btn ghost" data-days="30">' + t('sheet.block30') + '</button>' +
          '<button class="btn block" data-days="0">' + t('sheet.blockForever') + '</button>' +
          '<button class="btn ghost" id="block-cancel" style="grid-column:1/-1">' + t('sheet.cancel') + '</button>' +
        '</div>';
      body.querySelectorAll('[data-days]').forEach(function (b) {
        b.addEventListener('click', function () {
          store.blockMine(m.id, parseInt(b.getAttribute('data-days'), 10), m.type);
          closeSheet();
          app.pinnedMineId = null;
          afterChange(t('sheet.blocked'));
        });
      });
      body.querySelector('#block-cancel').addEventListener('click', closeSheet);
    });
  }

  // ── Map (Leaflet is only loaded when the tab is opened) ───────────────────
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
      s.onerror = function () { reject(new Error('Leaflet could not be loaded (offline?)')); };
      document.head.appendChild(s);
    });
  }

  function initMap() {
    if (app.mapReady) return Promise.resolve();
    return loadLeaflet().then(function (L) {
      var start = origin();
      app.map = L.map('map', { zoomControl: true, attributionControl: true })
        .setView(start ? [start.lat, start.lng] : [39.5, -98.35], start ? 17 : 4);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · mines: terramine.app'
      }).addTo(app.map);
      app.mineLayer = L.layerGroup().addTo(app.map);
      app.mapReady = true;
      updateMap(true);
      updateMeOnMap();
    }).catch(function (e) {
      $('map-hint').textContent = t('map.loadFail', { msg: e.message });
    });
  }

  function updateMeOnMap() {
    if (!app.mapReady || !app.pos) return;
    var L = window.L;
    if (app.meLayer) app.map.removeLayer(app.meLayer);
    if (app.radiusLayer) app.map.removeLayer(app.radiusLayer);
    app.meLayer = L.circleMarker([app.pos.lat, app.pos.lng], {
      radius: 7, color: '#4FC3F7', weight: 3, fillColor: '#4FC3F7', fillOpacity: .9
    }).addTo(app.map).bindPopup(t('map.yourLocation'));
    app.radiusLayer = L.circle([app.pos.lat, app.pos.lng], {
      radius: store.settings().radiusM, color: '#4FC3F7', weight: 1, opacity: .35, fill: false, dashArray: '4 6'
    }).addTo(app.map);
  }

  function updateMap(force) {
    if (!app.mapReady || (!app.mapDirty && !force)) return;
    var L = window.L, n = now();
    app.mineLayer.clearLayers();

    var targetIds = {};
    app.targets.forEach(function (x) { targetIds[x.mine.id] = true; });

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
        // Build popup content lazily — saves work with many mines.
        marker.bindPopup(function () { return minePopup(m, g, gs, store.mineStatus(m, g, Date.now())); });
        marker.on('popupopen', function (ev) { wirePopup(ev.popup, m, g); });
        app.mineLayer.addLayer(marker);
      });
    });
    app.mapDirty = false;
    var c = origin();
    if (force && c) app.map.setView([c.lat, c.lng], 17);
  }

  function minePopup(m, g, gs, ms) {
    var ownerKey = (store.mineRec(m.id) || {}).owner || gs.ownerKeys[0];
    var o = ownerKey ? store.owner(ownerKey) : null;
    var status = ms.state === 'blocked' ? t('map.statusBlocked')
      : gs.state === 'snoozed' ? t('map.statusSnoozed', { t: util.fmtClock(gs.until) })
      : (ms.state === 'cooldown' || gs.state === 'cooldown')
        ? t('map.statusCooldown', { t: util.fmtDuration((ms.until || gs.until) - now()) })
        : t('map.statusFree');
    return '<b>' + util.fmtCoord(m.lat, m.lng) + '</b><br>' +
      (TYPE_META[m.type] || TYPE_META.rock).emoji + ' ' + typeName(m.type) +
      ' · ' + t('map.block', { n: tiles(g.size) }) + '<br>' +
      '👤 ' + (o ? util.escapeHtml(o.name) : t('map.unknownOwner')) + ' · ' + status +
      '<div class="popup-actions">' +
        '<button class="btn small" data-pop="checkin">' + t('map.popupCheckin') + '</button>' +
        '<button class="btn small ghost" data-pop="copy">' + t('map.popupCopy') + '</button>' +
        '<button class="btn small ghost" data-pop="nav">' + t('map.popupRoute') + '</button>' +
      '</div>';
  }

  function wirePopup(popup, m, g) {
    var root = popup.getElement();
    if (!root) return;
    root.querySelectorAll('[data-pop]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-pop');
        if (act === 'copy') copyCoords(m, b);
        else if (act === 'nav') window.open(navUrl(m), '_blank', 'noopener');
        else {
          app.map.closePopup();
          openCheckIn({ mine: m, group: g, ownerName: store.ownerName(store.groupOwnerKeys(g)[0]) });
        }
      });
    });
  }

  // ── Settings / tabs / data ────────────────────────────────────────────────
  function syncSettingsUI() {
    var s = store.settings();
    $('rng-radius').value = s.radiusM;      $('lbl-radius').textContent = util.fmtDist(s.radiusM);
    $('rng-cooldown').value = s.cooldownH;  $('lbl-cooldown').textContent = s.cooldownH + ' h';
    $('rng-link').value = s.linkM;          $('lbl-link').textContent = s.linkM + ' m';
    $('chk-rare').checked = !!s.preferRare;
    document.querySelectorAll('[data-type]').forEach(function (c) {
      c.checked = s.types[c.getAttribute('data-type')] !== false;
    });
    document.querySelectorAll('#lang-switch .seg').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-lang') === i18n.lang());
    });
    $('btn-lang').textContent = i18n.lang() === 'en' ? 'DE' : 'EN';
  }

  /* Switch language: static markup, formats and every rendered view. */
  function setLanguage(lang) {
    i18n.setLang(lang);
    i18n.applyDom();
    syncSettingsUI();
    updateDiceUI();
    if (app.mapReady) { app.mapDirty = true; updateMap(); updateMeOnMap(); }
    renderAll();
    toast(t('toast.langSwitched'), 'ok');
  }

  function switchView(name) {
    app.view = name;
    ['radar', 'map', 'owners', 'more'].forEach(function (v) { $('view-' + v).hidden = v !== name; });
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.getAttribute('data-view') === name);
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
    toast(t('settings.exported'), 'ok');
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var mode_ = window.confirm(t('settings.importMode')) ? 'merge' : 'replace';
        store.importJson(String(reader.result), mode_);
        afterChange(t('settings.imported'));
      } catch (e) {
        toast(t('settings.importFail', { msg: e.message }), 'err');
      }
    };
    reader.readAsText(file);
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  function wire() {
    $('btn-locate').addEventListener('click', locate);
    $('btn-refresh').addEventListener('click', function () { refresh(true); });
    $('btn-lang').addEventListener('click', function () { setLanguage(i18n.lang() === 'en' ? 'de' : 'en'); });
    document.querySelectorAll('#lang-switch .seg').forEach(function (b) {
      b.addEventListener('click', function () { setLanguage(b.getAttribute('data-lang')); });
    });
    $('btn-undo').addEventListener('click', function () {
      var entry = store.undo();
      afterChange(entry ? t('toast.undone', { label: undoText(entry) }) : t('toast.nothingUndo'));
    });
    $('btn-manual').addEventListener('click', function () {
      var p = util.parseLatLng($('input-manual').value);
      if (!p) { toast(t('toast.coordsUnknown'), 'err'); return; }
      setPosition(p.lat, p.lng, null, 'manual');
      refresh();
    });
    $('input-manual').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btn-manual').click(); });
    $('chk-follow').addEventListener('change', function () { setFollow(this.checked); });

    document.querySelectorAll('#mode-switch .seg').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
    });
    $('btn-dice').addEventListener('click', function () { rollRandom(); });
    $('btn-world-map').addEventListener('click', function () {
      if (!app.worldPoint) { toast(t('world.needSpot'), 'err'); return; }
      switchView('map');
      initMap().then(function () {
        if (app.map) app.map.setView([app.worldPoint.lat, app.worldPoint.lng], 16);
      });
    });
    $('btn-world-reset').addEventListener('click', function () {
      store.clearVisitedCells();
      renderWorldCard();
      toast(t('world.visitedReset'), 'ok');
    });
    $('rng-world-min').addEventListener('input', function () {
      $('lbl-world-min').textContent = t('world.minMines', { n: this.value });
    });
    $('rng-world-min').addEventListener('change', function () {
      store.setSettings({ worldMinMines: +this.value });
      renderWorldCard();
    });
    document.querySelectorAll('#world-type-filters [data-wtype]').forEach(function (b) {
      b.addEventListener('click', function () {
        store.setSettings({ worldRequireType: b.getAttribute('data-wtype') });
        renderWorldCard();
      });
    });
    $('btn-world-filters').addEventListener('click', function () {
      var box = $('world-filters');
      box.hidden = !box.hidden;
      this.textContent = box.hidden ? t('world.filters') : t('world.filtersClose');
    });
    $('btn-manual-toggle').addEventListener('click', function () {
      var box = $('manual-box');
      box.hidden = !box.hidden;
      if (!box.hidden) $('input-manual').focus();
    });

    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchView(tab.getAttribute('data-view')); });
    });

    $('rng-radius').addEventListener('input', function () { $('lbl-radius').textContent = util.fmtDist(+this.value); });
    $('rng-radius').addEventListener('change', function () {
      store.setSettings({ radiusM: +this.value });
      syncSettingsUI(); updateMeOnMap(); refresh();
    });
    $('rng-cooldown').addEventListener('input', function () { $('lbl-cooldown').textContent = this.value + ' h'; });
    $('rng-cooldown').addEventListener('change', function () {
      store.setSettings({ cooldownH: +this.value });
      syncSettingsUI(); afterChange(t('settings.cooldownSet', { h: store.settings().cooldownH }));
    });
    $('rng-link').addEventListener('input', function () { $('lbl-link').textContent = this.value + ' m'; });
    $('rng-link').addEventListener('change', function () {
      store.setSettings({ linkM: +this.value });
      syncSettingsUI(); app.mapDirty = true; afterChange(t('settings.linkSet', { m: store.settings().linkM }));
    });
    $('chk-rare').addEventListener('change', function () {
      store.setSettings({ preferRare: this.checked });
      afterChange(this.checked ? t('settings.rareOn') : t('settings.rareOff'));
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
      toast(on ? t('settings.orderRoute') : t('settings.orderDistance'), 'ok');
    });

    $('btn-export').addEventListener('click', exportData);
    $('btn-import').addEventListener('click', function () { $('file-import').click(); });
    $('file-import').addEventListener('change', function () { if (this.files[0]) importData(this.files[0]); this.value = ''; });
    $('btn-reset').addEventListener('click', function () {
      if (window.confirm(t('settings.resetConfirm'))) {
        store.reset();
        afterChange(t('settings.resetDone'));
      }
    });

    $('btn-search-here').addEventListener('click', function () {
      if (!app.map) return;
      var c = app.map.getCenter();
      if (mode() === 'world') setMode('near');
      setPosition(c.lat, c.lng, null, 'manual');
      refresh();
    });

    $('sheet-backdrop').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

    window.addEventListener('online', function () { toast(t('toast.online'), 'ok'); refresh(); });
  }

  function start() {
    i18n.restore();
    i18n.applyDom();
    wire();
    syncSettingsUI();
    restorePosition();
    restoreWorldSpot();

    var m = mode();
    document.querySelectorAll('#mode-switch .seg').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === m);
    });
    $('card-near').hidden = m !== 'near';
    $('card-world').hidden = m === 'near';

    var cached = api.loadCache();
    if (cached && cached.mines.length) {
      app.mines = cached.mines;
      app.fetchedAt = cached.fetchedAt;
      app.fetchCenter = cached.center;
    }
    recompute();
    renderAll();

    if (origin()) refresh();

    // Keep cooldown countdowns and data age ticking.
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
