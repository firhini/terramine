# Owner Radar — TerraMine check-in tracker

🇬🇧 English · [🇩🇪 Deutsch](README.de.md)

Finds the **next mine of an owner you have not checked in with in the last 24 hours** — with exact
coordinates, a walking route and cooldown tracking. A plain static site: runs straight from GitHub
Pages, no server, no account, English and German interface.

<p>
  <img src=".github/preview-radar.png" alt="Radar with next target, route and cooldown" width="270" />
  <img src=".github/preview-world.png" alt="Worldwide random spot with exact coordinates" width="270" />
  <img src=".github/preview-map.png" alt="Map with free and blocked mines" width="270" />
</p>

## Two modes

| Mode | what it is for |
|---|---|
| 📍 **Nearby** | targets around your own location — for the round on your doorstep |
| 🎲 **Worldwide** | a random spot anywhere in the world, re-rolled at the tap of a button |

Rolling picks a random area from the worldwide mine overview (about 44,000 areas, 800,000+ mines),
loads the exact tiles there and shows the next target immediately. If no owner is free at that spot,
it keeps rolling automatically — up to six times. Under *Filters & options* you can set how many
mines must be on site and whether only areas **with diamond, gold or coal** are drawn. Visited spots
are remembered and skipped on the next roll.

## What the tool does

1. **Set a location** (GPS, type coordinates — or 🎲 roll one).
2. It loads every TerraAcre in range live from the public TerraMine endpoints — the same ones the
   official world map (`terramine.app/heatmap.html`) uses.
3. Connected blocks of tiles are grouped into **owner groups**.
4. You get **one target per owner** with the exact tile centre to five decimals, distance, compass
   direction and a navigation link. **One tap on the coordinates copies them** to the clipboard
   (with visible and tactile feedback); the same copy button sits in every route row, on the random
   spot and in the map popup.
5. After checking in inside the TerraMine app, tap **✅ Checked in** here — that owner disappears
   from the suggestions for 24 hours and you see when they come back.
6. Below that is the **walking route** through the remaining owners (nearest-neighbour, with total
   distance) — handy for the streak bonus (3 / 5 / 10 different owners a day = +10 / +25 / +50 TB).

## Publish on GitHub Pages

**Option A — no Actions (simplest)**

1. Repository → **Settings** → **Pages**
2. *Source*: **Deploy from a branch**
3. *Branch*: `claude/terramine-mine-tracker-mdxdex` (or `main` once merged), folder **`/ (root)`** → **Save**
4. A minute or two later the site is live at `https://<your-name>.github.io/terramine/`

**Option B — with Actions**

Set *Source* to **GitHub Actions**. The workflow `.github/workflows/pages.yml` then publishes on
every push to `main` or `claude/terramine-mine-tracker-mdxdex` (and manually via *Run workflow*).

**Built for phones**: single-column layout, every control at least 40–48 px tall, no sideways
scrolling down to a 360 px screen, controls within thumb reach, target right above the fold. The
rolled spot and all data survive switching to the TerraMine app and back.

**On your phone**: open the page → *Add to home screen*. The app shell is cached by a service
worker and starts even on a weak connection; mine data still comes live from the network. GPS only
works over HTTPS — the Pages URL covers that.

## Language

The interface ships in **English** and switches to **German** with the `DE` button in the header
(or under *More → Language*). The choice is remembered, and it also changes number formats,
compass points and dates.

## Usage

| Screen | what you get |
|---|---|
| **Radar** | mode switch 📍/🎲, next target, walking route, cooldown overview, daily streak |
| **Map** | every mine in range: green = free, grey = cooldown, red = blocked, yellow = current target |
| **Owners** | all recorded owners with remaining time; rename, merge, clear cooldown |
| **More** | language, radius, cooldown length, block spacing, type filters, history, export/import |

- **Tap the coordinates** to copy them — format `52.52000, 13.40500`.
- **⏭ Later** hides a group for 3 hours (not on your way right now).
- **🚫 Can’t reach** blocks a single mine permanently or temporarily (private property, building, water).
- **↺ in the header** undoes the last action; individual check-ins can also be deleted later in the
  history (tab *More*).

## How reliable is the owner detection?

The public API exposes **no owner IDs**, only coordinate and mine type. So:

- **Estimate:** a connected block of tiles (default: at most 25 m apart) counts as *one* owner.
  Players build their TerraAcres as a block around home, work or school almost every time.
- **Your confirmation beats the estimate:** if you enter the in-game owner name when ticking a
  target off, the radar remembers the name for the whole block. If the same name shows up somewhere
  else, both blocks share one cooldown.
- **Dense city blocks** can belong to several owners. Tick *“This block belongs to several owners”*
  on the check-in — a check-in then only blocks the 30 m around it instead of the whole block.
- **Block spacing** (tab *More*) controls how generously tiles are merged: smaller = more, finer
  groups; larger = fewer, coarser groups.

The check-in itself still happens in the TerraMine app on site (the game verifies GPS proximity).
This tool plans the round and keeps the books.

## Data and privacy

Everything — owners, cooldowns, check-ins, settings — lives solely in your browser’s
`localStorage`. Nothing is uploaded, there is no account and no tracking. Before switching devices
or clearing browser storage: *More → Data → Export*, then import on the new device (merge or
replace, your choice).

Only these two public endpoints are queried, and only for your surroundings:

```
GET .../getPropertiesInViewport?minLat=&maxLat=&minLng=&maxLng=   → mines in that box
GET .../getHeatmapData                                            → worldwide area overview (world mode only)
```

The world overview (approx. 3.6 MB) is only downloaded once you ask for it, then kept locally for
24 hours — the second roll needs no network for picking a spot.

## Development

```bash
npm test          # 59 unit tests (clustering, cooldowns, route, random spots, i18n, import/export)
npm start         # local server on http://localhost:8080
node tests/e2e.js # browser test with Playwright: real data, check-in, world mode, clipboard, languages
```

| File | contents |
|---|---|
| `assets/js/i18n.js` | English + German strings, `t()`, DOM translation |
| `assets/js/util.js` | geo maths, formats, IDs |
| `assets/js/cluster.js` | block detection (union-find over a metre grid) |
| `assets/js/world.js` | random spots: filter cells, draw one, compute the search box |
| `assets/js/store.js` | owners, cooldowns, target selection, route, import/export |
| `assets/js/api.js` | TerraMine endpoints incl. offline cache |
| `assets/js/app.js` | interface |
| `tests/run.js` | unit tests (`node --test`) |
| `tests/e2e.js` | browser test (Playwright, optional) |

## Legal

Unofficial helper, not affiliated with TerraMine. It only uses publicly available endpoints, changes
nothing in the game and automates no game actions — you still check in yourself in the app.
Map tiles: © OpenStreetMap contributors.

MIT licence.
