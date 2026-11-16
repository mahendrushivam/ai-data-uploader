# DataDesk: CSV Uploader

Upload a CSV, map its columns to types, then review and edit the data in an Excel-style grid.
Everything is stored in the browser's `localStorage` (no backend yet).

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
```

## Flow
1. **Login**: create an account or use **Continue with demo account**. This is mock auth: users and sessions live in localStorage, and passwords are salted SHA-256 hashes.
2. **Upload**: drag and drop a `.csv`, `.tsv`, or `.txt` file. The delimiter is auto-detected, and quoted cells with commas are handled. You can also click *Try sample data*.
3. **Map columns**: each column's type is auto-detected (a type is picked when 90% or more of the values fit it). You can rename, exclude, or retype a column, mark it required, and pick the split delimiter for multi-value columns. A live preview shows how the data renders and how many cells are invalid.
4. **Review in the grid**: an Excel-style sheet that autosaves on every change.

## Supported column types
Text · Number · Integer · Boolean · Date · Email · URL · Single select · **Multi-value list**.

A multi-value list holds several values in one cell, for example `"python, sql, ml"`. The cell is stored as an array and shown as chips. You edit it with a tag editor that suggests values already used in the column, and it is joined back with its delimiter on export.

Invalid values are never dropped. They are kept as typed and flagged with a red corner, and the formula bar shows the reason.

## Grid shortcuts
| Action | Keys |
|---|---|
| Move / extend selection | Arrows / Shift+Arrows, Tab, PageUp/PageDown, Home/End, ⌘+Arrow to the edge |
| Edit cell | Enter, F2, double-click, or just start typing |
| Commit and move | Enter (down), Shift+Enter (up), Tab (right) · Esc cancels |
| Clear cells | Delete / Backspace |
| Toggle checkbox | Space or click |
| Copy / cut / paste | ⌘C / ⌘X / ⌘V (tab-separated, works with Excel and Sheets; pasting past the last row adds rows) |
| Undo / redo | ⌘Z / ⌘⇧Z (or ⌘Y) |
| Select all | ⌘A |
| Row / column menus | Right-click a cell or row number · ▾ on a column header |

Other features: drag to select a range, drag a header edge to resize a column, sort from the header menu, search across all cells, an **issues** filter (rows with invalid cells), count/sum/average of the selection in the status bar, CSV export, and **live sync across tabs** (edits in one tab appear in the others).

## Structure
```
src/
  lib/columnTypes.ts   type detection, validation, conversion, multi-value split/join
  lib/storage.ts       localStorage persistence (swap this for an API later)
  lib/auth.ts          mock auth
  lib/csv.ts           PapaParse import/export
  components/Grid.tsx  virtualised spreadsheet: selection, keyboard, clipboard, formula and status bars
  components/CellEditor.tsx  text and tag editors
  pages/               Login, Dashboard, Upload (mapping wizard), Sheet
```

## Known limits / next steps
- localStorage holds about 5 MB per origin. Move to IndexedDB, or a backend with paginated rows, for large files.
- Auth runs only in the browser. Replace `lib/auth.ts` with a real identity provider.
- Ideas: per-column filters, frozen columns, fill handle, find and replace, bulk-fix suggestions for invalid cells, review status and comments per row, version history, collaborative editing over websockets.
