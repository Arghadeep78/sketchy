# Sketchy

A lightweight, web-based canvas editor built for the SolarLadder assignment. Create a canvas, drop in shapes/text/drawings, hit save, and reopen it anytime from the same URL.

**Live demo:** https://solarladder-7b1fa.web.app

## Stack

- React + Vite
- [Fabric.js](http://fabricjs.com/) v7 for the canvas
- Firebase Firestore for persistence (no auth)
- Plain CSS (no UI framework)

## How it works

1. **Home (`/`)** — "New Canvas" creates a Firestore doc and redirects to `/canvas/:canvasId`. The page also lists recent canvases (live-updated via `onSnapshot`).
2. **Editor (`/canvas/:canvasId`)** — Fabric.js canvas with a toolbar for rectangles, circles, text, freehand drawing, and a line tool. You can move, resize, rotate, recolor, or delete objects (Delete/Backspace). Undo/Redo works via Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, backed by a snapshot-based history stack. Canvas name is editable inline.
3. **Save** — serializes the canvas via `canvas.toJSON()`, writes the object list as a JSON string to Firestore, and rebuilds it on load with `loadFromJSON`.

## Bonus feature

**Export as PNG** — one-click download of the current canvas as a PNG.

## Setup

```bash
npm install
cp .env.example .env   # fill in your Firebase project config
npm run dev
```

### Firebase

Create a Firestore database (Native mode, test rules are fine since there's no auth) and fill in `.env` with your Firebase web app config (see `.env.example`). No extra Firestore indexes needed — the recent-canvases query uses a single-field `orderBy` which is auto-indexed.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run preview` — preview the production build
- `npm run lint` — lint the source

## Deployment (Firebase Hosting)

```bash
npm run build
firebase deploy --only hosting
```

`firebase.json` is already configured with a SPA rewrite (all routes serve `index.html`) so client-side routes like `/canvas/:id` work on refresh and direct link. `.firebaserc` points at the `solarladder-7b1fa` project.

## Notes / trade-offs

- No auth (per the spec) — anyone with the link can view and edit.
- Save is manual ("Save" button), not auto-save, to keep Firestore writes predictable.
- Everything lives in one `canvases` collection. The object graph is stored as a single JSON string field — good enough for this scope and avoids Firestore's nested-array restriction.
