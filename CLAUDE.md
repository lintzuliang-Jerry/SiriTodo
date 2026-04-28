# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SiriTodo 極速記** — A single-page PWA todo app with voice input, offline support, and horizontal pager navigation. No build system, no dependencies, no package.json. Everything is vanilla HTML/CSS/JS served as static files.

## Development

Serve locally with any static file server:
```
python -m http.server
```
Then open `http://localhost:8000` in a browser. The app must be served over HTTP (not `file://`) for the Service Worker and Web Speech API to work.

**Deploy**: Drag the entire project folder onto the Netlify site's Deploys tab. No build step.

**After any code change**: bump `CACHE_NAME` in `sw.js` (e.g. `siritodo-v5` → `siritodo-v6`) before deploying, otherwise phones serve stale cached files.

## Architecture

All logic lives in three files:

- **`index.html`** — Static shell. The pager contains 4 `<section class="page">` elements: clone-2 (routine), real-1 (today + longterm), real-2 (routine), clone-1 (today + longterm). The two clone pages enable infinite horizontal wrap-around scrolling. Each category's `<ul>` is empty on load; `renderList()` fills them.
- **`app.js`** — All state and logic. Key areas:
  - `todos` object (`{ today: [], routine: [], longterm: [] }`) persisted to `localStorage`.
  - `renderList(category)` — Rebuilds all matching `ul.list-{category}` elements across all 4 pages simultaneously (clones included). Also inserts `.cross-drop-slot` li at the top of today/longterm lists.
  - `bindGestures(li, handle, id, category)` — Custom pointer-event drag engine (no library). Adds `body.dragging-from-{category}` on drag start; removes on end. Handles cross-category drops via `.cross-drop-slot` elements.
  - `parseTask(text)` — Rule-based NLP router. Default category is `longterm`; `routine`/`today` keywords override. Strips matched keywords from the saved text.
  - `openEditModal(category, taskId)` / `saveEditModal()` — Shared modal for both new (+) and edit (pencil) flows. `editContext` tracks `{ category, taskId, isNew }`.
  - `initPagerWrapAround()` — Detects scroll hitting clone pages and silently jumps to the real counterpart.
- **`style.css`** — `body.dragging-from-longterm` triggers a `position: fixed` overlay for the longterm section covering today. `body.dragging-from-today` / `body.dragging-from-routine` release `overflow` constraints so the page can scroll during drag. `.cross-drop-slot.slot-hovered` provides visual feedback on hover.
- **`sw.js`** — Cache-first service worker. Bump `CACHE_NAME` string on every deploy to invalidate phone caches.

## Key Invariants

- **Clone sync**: `renderList()` always uses `document.querySelectorAll(listSelectors[category])` to update both the real page and its clone simultaneously. Never update a single `ul` by ID.
- **Drag state cleanup**: `endGesture()` must remove `body.dragging-from-{category}` and reset `document.documentElement.scrollTop = 0` to avoid layout artifacts.
- **Cross-category drop**: `endGesture()` reconstructs `todos[cat]` arrays by reading DOM order from the active page (`li.closest('.page')`), then falls back to `.page.real` if a category list isn't on the current page. `.cross-drop-slot` nodes are skipped because they lack `dataset.id`.
- **Voice default**: no-keyword voice input routes to `longterm` (not `today`). Only `routine` and `today` keywords actively redirect.
