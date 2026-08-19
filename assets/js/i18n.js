/* Sprachen / languages: English (default) + Deutsch.

   Keys are flat and dot-namespaced. Placeholders look like {name}.
   Static markup is translated via data-i18n attributes, dynamic strings via t(). */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var api = factory();
  if (isNode) module.exports = api;
  root.TM = Object.assign(root.TM || {}, { i18n: api });
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var LANG_KEY = 'terramine-owner-radar:lang';
  var DEFAULT = 'en';

  var STRINGS = {
    en: {
      'app.title': 'Owner Radar — TerraMine check-in tracker',
      'app.description': 'Finds the next TerraMine mine of an owner you have not checked in with for 24 hours — with exact coordinates.',

      'nav.radar': 'Radar', 'nav.map': 'Map', 'nav.owners': 'Owners', 'nav.more': 'More',
      'header.undo': 'Undo last action', 'header.refresh': 'Reload mines', 'header.language': 'Switch to German',

      'chip.noLocation': '📍 no location',
      'chip.gps': '📍 GPS', 'chip.manual': '📍 manual',
      'chip.notRolled': '🎲 not rolled yet',
      'chip.mines': '⛏ {n} mines', 'chip.groups': '👥 {n} groups',
      'chip.never': '⟳ never loaded', 'chip.justNow': '⟳ just now', 'chip.ago': '⟳ {t} ago',

      'mode.near': '📍 Nearby', 'mode.world': '🎲 Worldwide',

      'loc.title': 'Location', 'loc.gps': 'GPS',
      'loc.manualToggle': 'Enter coordinates manually',
      'loc.placeholder': '52.52000, 13.40500', 'loc.set': 'set',
      'loc.follow': 'Keep tracking my location',

      'world.title': 'Random spot',
      'world.dice': '🎲 Random spot worldwide', 'world.diceNext': '🎲 Next random spot',
      'world.searching': 'Searching spot … {n}/{max}', 'world.searchingShort': 'Searching spot …',
      'world.filters': '⚙ Filters & options', 'world.filtersClose': '⚙ Close filters',
      'world.minMines': 'At least {n} mines on site',
      'world.typeAny': 'any', 'world.typeCoal': '⚫ Coal', 'world.typeGold': '⭐ Gold', 'world.typeDiamond': '💎 Diamond',
      'world.showOnMap': 'Show on map', 'world.resetVisited': 'Reset visited spots',
      'world.hint': 'World data is downloaded the first time you roll (once, approx. 3.6 MB, then kept locally for 24 h).',
      'world.visited': '{n} spots visited', 'world.visitedOne': '1 spot visited',
      'world.copySpot': 'Copy spot',
      'world.loadedMines': '{n} mines loaded · {types}',
      'world.estimate': 'world overview says {n} mines · {types}',
      'world.rolled': '🎲 {n} mines on site · next target {dist}',
      'world.noFree': 'No free owner here right now — roll again.',
      'world.noCell': 'No matching area found in the world data.',
      'world.failed': 'Rolling failed.',
      'world.needSpot': 'Roll a random spot first.',
      'world.visitedReset': 'Visited random spots cleared.',

      'today.title': 'Today', 'today.checkIns': '{n} check-ins', 'today.checkInsOne': '1 check-in',
      'today.none': 'No check-ins yet today.',
      'today.streak': '<b>{owners}</b> different owners today — <b>{missing}</b> to go for the <b>+{bonus} TB</b> streak bonus.',
      'today.streakDone': '<b>{owners}</b> different owners today — every streak tier reached. 🔥',

      'target.label': 'Next target',
      'target.coordsSub': 'exact tile centre · grid approx. 11 m',
      'target.copyHint': 'tap to copy', 'target.copied': 'copied ✓',
      'target.distance': 'distance', 'target.distanceWorld': 'from spot', 'target.direction': 'direction',
      'target.blockFields': 'tiles in block', 'target.freeFields': 'free of those',
      'target.newOwner': '✨ new owner', 'target.lastSeen': 'last seen {t} ago',
      'target.checkin': '✅ Checked in', 'target.copy': '📋 Copy', 'target.map': '🧭 Map',
      'target.later': '⏭ Later', 'target.blocked': '🚫 Can’t reach',

      'empty.rollTitle': 'Roll the dice',
      'empty.rollText': 'Tap <b>🎲 Random spot worldwide</b> above — the app picks any area in the world that has mines and shows you the nearest mine of an owner you have not checked in with for {h} hours.',
      'empty.startTitle': 'Let’s go',
      'empty.startText': 'Set your location above (GPS or coordinates) — the radar then finds the nearest mine of an owner you have not had today. Or switch to <b>🎲 Worldwide</b>.',
      'empty.noMinesTitle': 'No mines nearby',
      'empty.noMinesWorld': 'Nothing to grab at this random spot — just roll again.',
      'empty.noMinesNear': 'Not a single tile is claimed within {r}. Increase the radius (tab <b>More</b>) or switch to <b>🎲 Worldwide</b>.',
      'empty.noDataTitle': 'No data',
      'empty.noDataText': 'No mines loaded yet. Tap ⟳ at the top right.',
      'empty.noFreeTitle': 'No free owner',
      'empty.noFreeText': 'All {n} groups here are on cooldown, skipped or hidden by the type filter. ',
      'empty.noFreeWorld': 'Roll a new spot.',
      'empty.noFreeNear': 'Increase the radius, loosen the filter — or check below when the next owner frees up.',

      'list.title': 'Further targets',
      'list.orderRoute': 'Route', 'list.orderDistance': 'Distance',
      'list.routeSummary': '{n} owners · {dist} round', 'list.moreOwners': '{n} more owners',
      'list.none': 'No other free owners in range.',
      'list.fromFirst': '{dist} from target 1',
      'list.fields': '{n} tiles', 'list.fieldsOne': '1 tile',
      'list.copy': 'Copy coordinates',

      'cooldown.title': 'On cooldown', 'cooldown.none': 'No owner on cooldown.',
      'cooldown.count': '{n} owners', 'cooldown.countOne': '1 owner', 'cooldown.freeIn': 'free in {t}',

      'owners.title': 'Owners',
      'owners.hint': 'One entry per owner. Enter the in-game name when you tick a target off — then every block of that owner shares one cooldown.',
      'owners.summary': '{total} total · {cool} on cooldown',
      'owners.none': 'No owners recorded yet. Tick off your first target on the radar.',
      'owners.free': 'free', 'owners.in': 'in {t}',
      'owners.checkIns': '{n} check-ins', 'owners.checkInsOne': '1 check-in', 'owners.last': 'last {t}',
      'owners.rename': 'Name', 'owners.resetCooldown': 'Clear cooldown', 'owners.delete': 'Delete',
      'owners.renamePrompt': 'Owner name (as shown in the game):',
      'owners.deleteConfirm': 'Really delete “{name}”? The cooldown and tile assignment will be lost.',
      'owners.saved': 'Owner saved.', 'owners.cooldownCleared': 'Cooldown cleared.', 'owners.deleted': 'Owner deleted.',

      'history.title': 'History', 'history.count': '{n} total',
      'history.none': 'No check-ins booked yet.', 'history.unknown': 'unknown',
      'history.delete': 'Delete check-in',
      'history.deleteConfirm': 'Delete this check-in? The owner’s cooldown then follows the previous entry.',
      'history.deleted': 'Check-in deleted.',

      'settings.title': 'Settings',
      'settings.radius': 'Search radius', 'settings.cooldown': 'Cooldown per owner', 'settings.link': 'Block spacing',
      'settings.linkHint': 'How far apart two tiles may be and still count as one owner’s block.',
      'settings.types': 'Mine types',
      'settings.rock': '🪨 Rock', 'settings.coal': '⚫ Coal', 'settings.gold': '⭐ Gold', 'settings.diamond': '💎 Diamond',
      'settings.rare': 'Prefer rare mines (small detour allowed)',
      'settings.language': 'Language',
      'settings.data': 'Data',
      'settings.dataHint': 'Everything lives in this browser only. Export a backup before clearing browser storage or switching devices.',
      'settings.export': 'Export (.json)', 'settings.import': 'Import', 'settings.reset': 'Delete everything',
      'settings.resetConfirm': 'Really delete all owners, cooldowns and check-ins?',
      'settings.resetDone': 'Everything reset.',
      'settings.exported': 'Backup downloaded.', 'settings.imported': 'Data imported.',
      'settings.importMode': 'OK = merge with the current data\nCancel = replace the current data',
      'settings.importFail': 'Could not read the file: {msg}',
      'settings.cooldownSet': 'Cooldown: {h} h', 'settings.linkSet': 'Block spacing: {m} m',
      'settings.rareOn': 'Rare mines preferred.', 'settings.rareOff': 'Sorted purely by distance.',
      'settings.orderRoute': 'Order follows the walking route.', 'settings.orderDistance': 'Order follows straight-line distance.',

      'how.title': 'How it works',
      'how.p1': '<b>Data source:</b> mines come live from the public TerraMine endpoints that the official world map uses too. Only your surroundings are requested, never the whole dataset.',
      'how.p2': '<b>Owner detection:</b> the API does not expose owner IDs. Connected blocks of tiles are therefore treated as <i>one</i> owner — which is how players build their TerraAcres in practice. As soon as you enter a name when ticking a target off, the name wins: all blocks of that owner then share one cooldown.',
      'how.p3': '<b>Cooldown:</b> after ticking off, the owner disappears from the suggestions for 24 hours (adjustable). Only one target per owner is suggested, sorted by walking distance.',
      'how.p4': '<b>Dense blocks:</b> if one connected block belongs to several owners, mark it as “multiple owners” on the target — a check-in then only blocks the 30 m around it instead of the whole block.',
      'how.p5': '<b>The check-in itself</b> still happens in the TerraMine app on site (GPS proximity). This tool only plans the round and keeps track of who you already had.',

      'sheet.checkinTitle': 'Book check-in',
      'sheet.ownerName': 'Owner name', 'sheet.ownerOptional': 'optional, but recommended',
      'sheet.namePlaceholder': 'name from the game',
      'sheet.multiOwner': 'This block belongs to several owners ({n} tiles) — the check-in then only blocks 30 m around it',
      'sheet.save': 'Save check-in', 'sheet.anon': 'Without name', 'sheet.cancel': 'Cancel',
      'sheet.checkinHint': 'The name is shown on the tile in the TerraMine app. With a name the radar also recognises other blocks of the same person.',
      'sheet.booked': '✅ {name} booked — free from {time}', 'sheet.bookedNext': ' · next target {dist} {dir}',

      'sheet.blockTitle': 'Block mine',
      'sheet.blockText': 'Not reachable (private property, building, water)? Then the radar stops suggesting <code>{coords}</code>. Other tiles of the same owner stay in play.',
      'sheet.block7': '7 days', 'sheet.block30': '30 days', 'sheet.blockForever': 'Block permanently',
      'sheet.blocked': 'Mine blocked.',

      'sheet.worldTitle': 'Download world data',
      'sheet.worldText': 'For random spots the app needs the overview of every mine area in the world once: <b>approx. 3.6 MB</b>. It then stays on the device for 24 hours — best downloaded on Wi-Fi.',
      'sheet.worldStart': 'Download now', 'sheet.worldLoading': 'Downloading …',
      'sheet.worldProgress': '{mb} MB downloaded', 'sheet.worldProgressOf': '{mb} MB of {total} MB downloaded',
      'sheet.cancelled': 'Cancelled.',

      'map.legendFree': 'free', 'map.legendCool': 'cooldown', 'map.legendBlocked': 'blocked', 'map.legendMe': 'you',
      'map.searchHere': 'Search here',
      'map.hint': 'Tap a mine: set as target, book a check-in or block it.',
      'map.loadFail': '{msg} The radar works without the map too.',
      'map.yourLocation': 'Your location',
      'map.block': 'block: {n}',
      'map.unknownOwner': 'unknown',
      'map.statusBlocked': 'blocked', 'map.statusSnoozed': 'skipped until {t}',
      'map.statusCooldown': 'cooldown {t} left', 'map.statusFree': 'free',
      'map.popupCheckin': 'Check in', 'map.popupCopy': 'Copy', 'map.popupRoute': 'Route',

      'toast.copied': '📋 {text}', 'toast.copyFail': 'Could not copy: {text}',
      'toast.undone': 'Undone: {label}', 'toast.nothingUndo': 'Nothing to undo.',
      'toast.skipped': 'Group skipped for {h} h.',
      'toast.needLocation': 'Set your location first — tap GPS or enter coordinates.',
      'toast.coordsUnknown': 'Coordinates not recognised. Example: 52.52000, 13.40500',
      'toast.truncated': 'The area was too large — the server truncated it. Choose a smaller radius.',
      'toast.offline': 'Offline — showing the last saved state.',
      'toast.online': 'Back online.',
      'toast.loadFail': 'Loading failed.',
      'toast.langSwitched': 'Language: English',

      'geo.unavailable': 'Location unavailable.',
      'geo.denied': 'Location permission denied — allow access or enter the coordinates manually.',
      'geo.position': 'No GPS signal. Try again outdoors or enter coordinates manually.',
      'geo.timeout': 'GPS took too long. Try again.',
      'geo.unsupported': 'This browser cannot determine a location.',

      'undo.checkin': 'check-in for {name}', 'undo.rename': 'owner renamed', 'undo.merge': 'owners merged',
      'undo.deleteOwner': 'owner deleted', 'undo.resetCooldown': 'cooldown cleared', 'undo.blockMine': 'mine blocked',
      'undo.unblockMine': 'block removed', 'undo.multiOwner': 'multi-owner marking', 'undo.snooze': 'group skipped',
      'undo.import': 'data imported', 'undo.reset': 'everything reset', 'undo.deleteCheckin': 'check-in deleted',
      'undo.clearVisited': 'visited spots reset', 'undo.mine': 'mine {id}'
    },

    de: {
      'app.title': 'Owner Radar — TerraMine Check-in Tracker',
      'app.description': 'Findet die nächste TerraMine-Mine eines Owners, bei dem du in den letzten 24 Stunden nicht eingecheckt hast — mit exakten Koordinaten.',

      'nav.radar': 'Radar', 'nav.map': 'Karte', 'nav.owners': 'Owner', 'nav.more': 'Mehr',
      'header.undo': 'Letzte Aktion rückgängig', 'header.refresh': 'Minen neu laden', 'header.language': 'Auf Englisch umschalten',

      'chip.noLocation': '📍 kein Standort',
      'chip.gps': '📍 GPS', 'chip.manual': '📍 manuell',
      'chip.notRolled': '🎲 noch nicht gewürfelt',
      'chip.mines': '⛏ {n} Minen', 'chip.groups': '👥 {n} Gruppen',
      'chip.never': '⟳ nie geladen', 'chip.justNow': '⟳ gerade eben', 'chip.ago': '⟳ vor {t}',

      'mode.near': '📍 Umkreis', 'mode.world': '🎲 Weltweit',

      'loc.title': 'Standort', 'loc.gps': 'GPS',
      'loc.manualToggle': 'Koordinaten von Hand eingeben',
      'loc.placeholder': '52.52000, 13.40500', 'loc.set': 'setzen',
      'loc.follow': 'Standort laufend verfolgen',

      'world.title': 'Zufallsort',
      'world.dice': '🎲 Zufallsort weltweit', 'world.diceNext': '🎲 Nächster Zufallsort',
      'world.searching': 'Suche Ort … {n}/{max}', 'world.searchingShort': 'Suche Ort …',
      'world.filters': '⚙ Filter & Optionen', 'world.filtersClose': '⚙ Filter schließen',
      'world.minMines': 'Mindestens {n} Minen vor Ort',
      'world.typeAny': 'alle', 'world.typeCoal': '⚫ Kohle', 'world.typeGold': '⭐ Gold', 'world.typeDiamond': '💎 Diamant',
      'world.showOnMap': 'Auf Karte zeigen', 'world.resetVisited': 'Besuchte Orte zurücksetzen',
      'world.hint': 'Die Weltdaten werden beim ersten Würfeln geladen (einmalig ca. 3,6 MB, danach 24 h lokal gespeichert).',
      'world.visited': '{n} Orte besucht', 'world.visitedOne': '1 Ort besucht',
      'world.copySpot': 'Ort kopieren',
      'world.loadedMines': '{n} Minen geladen · {types}',
      'world.estimate': 'laut Weltübersicht {n} Minen · {types}',
      'world.rolled': '🎲 {n} Minen vor Ort · nächstes Ziel {dist}',
      'world.noFree': 'Hier ist gerade kein freier Owner — nochmal würfeln.',
      'world.noCell': 'Keine passende Gegend in den Weltdaten gefunden.',
      'world.failed': 'Würfeln fehlgeschlagen.',
      'world.needSpot': 'Erst einen Zufallsort würfeln.',
      'world.visitedReset': 'Besuchte Zufallsorte zurückgesetzt.',

      'today.title': 'Heute', 'today.checkIns': '{n} Check-ins', 'today.checkInsOne': '1 Check-in',
      'today.none': 'Heute noch keine Check-ins.',
      'today.streak': '<b>{owners}</b> verschiedene Owner heute — noch <b>{missing}</b> bis <b>+{bonus} TB</b> Streak-Bonus.',
      'today.streakDone': '<b>{owners}</b> verschiedene Owner heute — alle Streak-Stufen erreicht. 🔥',

      'target.label': 'Nächstes Ziel',
      'target.coordsSub': 'Feldmitte · Raster ~11 m',
      'target.copyHint': 'tippen zum Kopieren', 'target.copied': 'kopiert ✓',
      'target.distance': 'Entfernung', 'target.distanceWorld': 'ab Zufallsort', 'target.direction': 'Richtung',
      'target.blockFields': 'Felder im Block', 'target.freeFields': 'davon frei',
      'target.newOwner': '✨ neuer Owner', 'target.lastSeen': 'zuletzt vor {t}',
      'target.checkin': '✅ Check-in gemacht', 'target.copy': '📋 Kopieren', 'target.map': '🧭 Karte',
      'target.later': '⏭ Später', 'target.blocked': '🚫 Nicht erreichbar',

      'empty.rollTitle': 'Würfeln',
      'empty.rollText': 'Tippe oben auf <b>🎲 Zufallsort weltweit</b> — die App sucht eine beliebige Gegend auf der Welt mit Minen und zeigt dir dort die nächste Mine eines Owners ohne Check-in in den letzten {h} Stunden.',
      'empty.startTitle': 'Los geht’s',
      'empty.startText': 'Setz oben deinen Standort (GPS oder Koordinaten) — danach sucht der Radar automatisch die nächste Mine eines Owners, den du heute noch nicht hattest. Oder wechsle oben auf <b>🎲 Weltweit</b>.',
      'empty.noMinesTitle': 'Keine Minen in der Nähe',
      'empty.noMinesWorld': 'An diesem Zufallsort ist nichts zu holen — einfach nochmal würfeln.',
      'empty.noMinesNear': 'Im Umkreis von {r} ist kein einziges Feld vergeben. Erhöhe den Radius (Tab <b>Mehr</b>) oder wechsle auf <b>🎲 Weltweit</b>.',
      'empty.noDataTitle': 'Keine Daten',
      'empty.noDataText': 'Noch keine Minen geladen. Tippe oben rechts auf ⟳.',
      'empty.noFreeTitle': 'Kein freier Owner',
      'empty.noFreeText': 'Alle {n} Gruppen hier sind im Cooldown, übersprungen oder durch den Typfilter ausgeblendet. ',
      'empty.noFreeWorld': 'Würfle einen neuen Ort.',
      'empty.noFreeNear': 'Erhöhe den Radius, lockere den Filter — oder schau unten, wann der nächste Owner frei wird.',

      'list.title': 'Weitere Ziele',
      'list.orderRoute': 'Route', 'list.orderDistance': 'Entfernung',
      'list.routeSummary': '{n} Owner · {dist} Runde', 'list.moreOwners': '{n} weitere Owner',
      'list.none': 'Keine weiteren freien Owner im Umkreis.',
      'list.fromFirst': '{dist} ab Ziel 1',
      'list.fields': '{n} Felder', 'list.fieldsOne': '1 Feld',
      'list.copy': 'Koordinaten kopieren',

      'cooldown.title': 'Im Cooldown', 'cooldown.none': 'Kein Owner im Cooldown.',
      'cooldown.count': '{n} Owner', 'cooldown.countOne': '1 Owner', 'cooldown.freeIn': 'frei in {t}',

      'owners.title': 'Owner',
      'owners.hint': 'Ein Eintrag pro Owner. Vergib beim Abhaken den Namen aus dem Spiel — dann teilen sich alle Blocks dieses Owners denselben Cooldown.',
      'owners.summary': '{total} gesamt · {cool} im Cooldown',
      'owners.none': 'Noch keine Owner erfasst. Hake dein erstes Ziel im Radar ab.',
      'owners.free': 'frei', 'owners.in': 'in {t}',
      'owners.checkIns': '{n} Check-ins', 'owners.checkInsOne': '1 Check-in', 'owners.last': 'zuletzt {t}',
      'owners.rename': 'Name', 'owners.resetCooldown': 'Cooldown aufheben', 'owners.delete': 'Löschen',
      'owners.renamePrompt': 'Name des Owners (wie im Spiel angezeigt):',
      'owners.deleteConfirm': '„{name}“ wirklich löschen? Der Cooldown und die Zuordnung gehen verloren.',
      'owners.saved': 'Owner gespeichert.', 'owners.cooldownCleared': 'Cooldown aufgehoben.', 'owners.deleted': 'Owner gelöscht.',

      'history.title': 'Verlauf', 'history.count': '{n} gesamt',
      'history.none': 'Noch keine Check-ins gebucht.', 'history.unknown': 'unbekannt',
      'history.delete': 'Check-in löschen',
      'history.deleteConfirm': 'Diesen Check-in löschen? Der Cooldown des Owners richtet sich danach nach dem vorherigen Eintrag.',
      'history.deleted': 'Check-in gelöscht.',

      'settings.title': 'Einstellungen',
      'settings.radius': 'Suchradius', 'settings.cooldown': 'Cooldown pro Owner', 'settings.link': 'Blockabstand',
      'settings.linkHint': 'Wie weit zwei Felder auseinanderliegen dürfen, damit sie noch als Block eines Owners gelten.',
      'settings.types': 'Minentypen',
      'settings.rock': '🪨 Stein', 'settings.coal': '⚫ Kohle', 'settings.gold': '⭐ Gold', 'settings.diamond': '💎 Diamant',
      'settings.rare': 'Seltene Minen bevorzugen (kleiner Umweg erlaubt)',
      'settings.language': 'Sprache',
      'settings.data': 'Daten',
      'settings.dataHint': 'Alles liegt nur in diesem Browser. Sicherung exportieren, bevor du den Browser-Speicher leerst oder das Gerät wechselst.',
      'settings.export': 'Export (.json)', 'settings.import': 'Import', 'settings.reset': 'Alles löschen',
      'settings.resetConfirm': 'Wirklich alle Owner, Cooldowns und Check-ins löschen?',
      'settings.resetDone': 'Alles zurückgesetzt.',
      'settings.exported': 'Sicherung heruntergeladen.', 'settings.imported': 'Daten importiert.',
      'settings.importMode': 'OK = mit dem aktuellen Stand zusammenführen\nAbbrechen = aktuellen Stand ersetzen',
      'settings.importFail': 'Datei konnte nicht gelesen werden: {msg}',
      'settings.cooldownSet': 'Cooldown: {h} h', 'settings.linkSet': 'Blockabstand: {m} m',
      'settings.rareOn': 'Seltene Minen bevorzugt.', 'settings.rareOff': 'Rein nach Entfernung sortiert.',
      'settings.orderRoute': 'Reihenfolge als Laufroute.', 'settings.orderDistance': 'Reihenfolge nach Luftlinie.',

      'how.title': 'So funktioniert es',
      'how.p1': '<b>Datenquelle:</b> die Minen kommen live von den öffentlichen TerraMine-Endpunkten, die auch die offizielle Weltkarte nutzt. Abgefragt wird immer nur dein Umkreis, nie der ganze Datensatz.',
      'how.p2': '<b>Owner-Erkennung:</b> die API gibt keine Owner-IDs heraus. Zusammenhängende Felderblöcke werden deshalb als <i>ein</i> Owner behandelt — so bauen Spieler ihre TerraAcres praktisch immer. Sobald du beim Abhaken einen Namen einträgst, zählt der Name: alle Blocks dieses Owners teilen sich dann einen Cooldown.',
      'how.p3': '<b>Cooldown:</b> nach dem Abhaken verschwindet der Owner für 24 Stunden (einstellbar) aus den Vorschlägen. Vorgeschlagen wird immer nur ein Ziel pro Owner, sortiert nach Laufweg.',
      'how.p4': '<b>Sonderfall dichter Block:</b> gehört ein zusammenhängender Block mehreren Ownern, markiere ihn beim Ziel als „mehrere Owner“ — dann sperrt ein Check-in nur die 30 m rundherum statt des ganzen Blocks.',
      'how.p5': '<b>Der Check-in selbst</b> passiert weiter in der TerraMine-App vor Ort (GPS-Nähe). Dieses Tool plant nur die Runde und merkt sich, wen du schon hattest.',

      'sheet.checkinTitle': 'Check-in buchen',
      'sheet.ownerName': 'Owner-Name', 'sheet.ownerOptional': 'optional, aber empfohlen',
      'sheet.namePlaceholder': 'Name aus dem Spiel',
      'sheet.multiOwner': 'Dieser Block gehört mehreren Ownern ({n} Felder) — dann sperrt der Check-in nur 30 m rundherum',
      'sheet.save': 'Check-in speichern', 'sheet.anon': 'Ohne Namen', 'sheet.cancel': 'Abbrechen',
      'sheet.checkinHint': 'Der Name steht in der TerraMine-App auf dem Feld. Mit Namen erkennt der Radar auch andere Blocks derselben Person.',
      'sheet.booked': '✅ {name} gebucht — frei ab {time}', 'sheet.bookedNext': ' · nächstes Ziel {dist} {dir}',

      'sheet.blockTitle': 'Mine sperren',
      'sheet.blockText': 'Nicht erreichbar (Privatgelände, Gebäude, Wasser)? Dann schlägt der Radar <code>{coords}</code> nicht mehr vor. Andere Felder desselben Owners bleiben nutzbar.',
      'sheet.block7': '7 Tage', 'sheet.block30': '30 Tage', 'sheet.blockForever': 'Dauerhaft sperren',
      'sheet.blocked': 'Mine gesperrt.',

      'sheet.worldTitle': 'Weltdaten laden',
      'sheet.worldText': 'Für Zufallsorte braucht die App einmalig die Übersicht aller Minen-Gegenden der Welt: <b>ca. 3,6 MB</b>. Danach liegt sie 24 Stunden lokal auf dem Gerät — am besten im WLAN laden.',
      'sheet.worldStart': 'Jetzt laden', 'sheet.worldLoading': 'Lädt …',
      'sheet.worldProgress': '{mb} MB geladen', 'sheet.worldProgressOf': '{mb} MB von {total} MB geladen',
      'sheet.cancelled': 'Abgebrochen.',

      'map.legendFree': 'frei', 'map.legendCool': 'Cooldown', 'map.legendBlocked': 'gesperrt', 'map.legendMe': 'du',
      'map.searchHere': 'Hier suchen',
      'map.hint': 'Tippe eine Mine an: Ziel setzen, Check-in buchen oder sperren.',
      'map.loadFail': '{msg} Der Radar funktioniert auch ohne Karte.',
      'map.yourLocation': 'Dein Standort',
      'map.block': 'Block: {n}',
      'map.unknownOwner': 'unbekannt',
      'map.statusBlocked': 'gesperrt', 'map.statusSnoozed': 'übersprungen bis {t}',
      'map.statusCooldown': 'Cooldown noch {t}', 'map.statusFree': 'frei',
      'map.popupCheckin': 'Check-in', 'map.popupCopy': 'Kopieren', 'map.popupRoute': 'Route',

      'toast.copied': '📋 {text}', 'toast.copyFail': 'Kopieren nicht möglich: {text}',
      'toast.undone': 'Rückgängig: {label}', 'toast.nothingUndo': 'Nichts rückgängig zu machen.',
      'toast.skipped': 'Gruppe für {h} h übersprungen.',
      'toast.needLocation': 'Erst Standort setzen — GPS antippen oder Koordinaten eintragen.',
      'toast.coordsUnknown': 'Koordinaten nicht erkannt. Beispiel: 52.52000, 13.40500',
      'toast.truncated': 'Der Bereich war zu groß — der Server hat gekürzt. Kleineren Radius wählen.',
      'toast.offline': 'Offline — zeige den letzten gespeicherten Stand.',
      'toast.online': 'Wieder online.',
      'toast.loadFail': 'Laden fehlgeschlagen.',
      'toast.langSwitched': 'Sprache: Deutsch',

      'geo.unavailable': 'Standort nicht verfügbar.',
      'geo.denied': 'Standortfreigabe abgelehnt — erlaube den Zugriff oder trage die Koordinaten manuell ein.',
      'geo.position': 'Kein GPS-Signal. Draußen erneut versuchen oder Koordinaten manuell eintragen.',
      'geo.timeout': 'GPS hat zu lange gebraucht. Nochmal versuchen.',
      'geo.unsupported': 'Dieser Browser kann keinen Standort ermitteln.',

      'undo.checkin': 'Check-in bei {name}', 'undo.rename': 'Owner umbenannt', 'undo.merge': 'Owner zusammengeführt',
      'undo.deleteOwner': 'Owner gelöscht', 'undo.resetCooldown': 'Cooldown zurückgesetzt', 'undo.blockMine': 'Mine gesperrt',
      'undo.unblockMine': 'Sperre aufgehoben', 'undo.multiOwner': 'Mehr-Owner-Markierung', 'undo.snooze': 'Gruppe übersprungen',
      'undo.import': 'Daten importiert', 'undo.reset': 'alles zurückgesetzt', 'undo.deleteCheckin': 'Check-in gelöscht',
      'undo.clearVisited': 'Zufallsorte zurückgesetzt', 'undo.mine': 'Mine {id}'
    }
  };

  var current = DEFAULT;

  function available() { return Object.keys(STRINGS); }

  function lang() { return current; }

  function setLang(l) {
    current = STRINGS[l] ? l : DEFAULT;
    try { localStorage.setItem(LANG_KEY, current); } catch (e) {}
    if (typeof TM !== 'undefined' && TM.util && TM.util.setLocale) TM.util.setLocale(current);
    return current;
  }

  function restore() {
    var saved = null;
    try { saved = localStorage.getItem(LANG_KEY); } catch (e) {}
    return setLang(saved || DEFAULT);
  }

  /* t('list.fields', { n: 3 }) */
  function t(key, params) {
    var dict = STRINGS[current] || STRINGS[DEFAULT];
    var s = dict[key];
    if (s == null) s = STRINGS[DEFAULT][key];
    if (s == null) return key;                       // fehlender Schluessel bleibt sichtbar
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, function (m, name) {
      return params[name] == null ? m : String(params[name]);
    });
  }

  /* Statisches Markup uebersetzen:
     data-i18n="key" -> Textinhalt, data-i18n-html="key" -> HTML,
     data-i18n-ph / data-i18n-title -> Attribute. */
  function applyDom(rootEl) {
    var scope = rootEl || document;
    scope.querySelectorAll('[data-i18n]').forEach(function (n) {
      n.textContent = t(n.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-html]').forEach(function (n) {
      n.innerHTML = t(n.getAttribute('data-i18n-html'));
    });
    scope.querySelectorAll('[data-i18n-ph]').forEach(function (n) {
      n.setAttribute('placeholder', t(n.getAttribute('data-i18n-ph')));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach(function (n) {
      n.setAttribute('title', t(n.getAttribute('data-i18n-title')));
    });
    if (!rootEl) {
      document.documentElement.setAttribute('lang', current);
      document.title = t('app.title');
    }
  }

  return {
    STRINGS: STRINGS, DEFAULT: DEFAULT, LANG_KEY: LANG_KEY,
    t: t, lang: lang, setLang: setLang, restore: restore, applyDom: applyDom, available: available
  };
});
