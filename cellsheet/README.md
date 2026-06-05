# Cellsheet

A mobile-first, open-source CSV viewer. Open any spreadsheet — from a **link** or a
**file** — and read it the way phones actually work: tap a row to open it as a card,
swipe between rows, tap a column to filter, and search everything at once.

It's a Progressive Web App (PWA): it lives at a URL, installs to your home screen,
works offline, and on Android registers as an "Open with" handler for `.csv` files.

## Features

- **Open from anywhere** — paste a REST/CSV URL (e.g. an open-data endpoint) or pick a
  file from your phone, iCloud, Drive, or Downloads.
- **Tap a row → card view** — headers and values as a clean key/value list.
- **Swipe left/right** between rows while in the card view.
- **Tap a column → type-aware filter** — numeric ranges, date ranges, a checklist for
  low-cardinality text, or a contains-search otherwise.
- **Universal search** across all columns, with `*` and `?` wildcards.
- **Handles large files** — rows are virtualized, so tens of thousands scroll smoothly.
- **Installable + offline** via service worker.

## Getting started

```bash
npm install
npm run dev      # start the dev server (open the printed URL on your phone too)
npm run build    # production build into dist/
npm run preview  # serve the production build locally
```

To try it instantly, click **"Try an example (SF open data)"** on the open screen, or
visit the app with a `?url=` parameter:

```
http://localhost:5173/?url=https://data.sfgov.org/resource/n9pm-xkyq.csv
```

## Tech stack

- **React 19 + Vite + TypeScript**
- **PapaParse** — CSV parsing (streams large files / URL downloads)
- **TanStack Virtual** — row virtualization
- **Framer Motion** — the swipe-between-cards gesture
- **Tailwind CSS** — mobile-first styling
- **vite-plugin-pwa** — manifest + offline service worker

## Project layout

```
src/
  lib/
    parseCsv.ts   CSV parsing + column type detection (URL & file)
    filter.ts     filter/search logic + wildcard matching
    recents.ts    recent-URL history (localStorage)
  components/
    OpenScreen.tsx        URL box + Choose File + recents
    SearchBar.tsx         universal wildcard search
    TableView.tsx         virtualized table; tap row / tap column
    RowCard.tsx           swipeable full-screen row card
    ColumnFilterSheet.tsx type-aware per-column filter sheet
  App.tsx         orchestration & state
  types.ts        Dataset / Column / Row types
```

## Roadmap ideas

- iOS "Open with" + share-target via a Capacitor native wrapper (same codebase).
- Web Share Target API (Android) so you can share a CSV *to* Cellsheet.
- Column sorting, multi-column sort.
- PNG app icons (currently a single SVG icon).
- Export the current filtered view back to CSV.

## License

MIT (open source).
