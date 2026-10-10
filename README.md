# Physique

Personal training log — a single self-contained `index.html` (no build step).
Open it in a browser; sessions are saved to `localStorage` under keys like
`session:YYYY-MM-DD_<sessiontype>`.

## Tests

Headless Playwright (Chromium):

```sh
npm install
npm test
```

## Moving data between devices / out of Claude.ai

Log tab → **Backup**: *Export file* (or *Copy JSON* where downloads are
blocked) and *Import file* / paste. Imports merge by key; on a conflict the
copy with the newer `savedAt` wins. When the page runs inside a Claude.ai
artifact it reads `window.storage`, so pasting this file into the artifact and
exporting there is how to bring existing artifact history over.
