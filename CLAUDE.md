# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mogy is a keyboard-driven MongoDB query UI with first-class Vim support. Built with Tauri v2 + React + CodeMirror. Catppuccin Mocha theme throughout.

## Commands

```bash
# Install dependencies
bun install

# Development
bun run tauri dev

# Run Rust tests
cd src-tauri && cargo test

# Run a specific test
cd src-tauri && cargo test test_name

# Build production
bun run tauri build
```

## Architecture

### Frontend (`src/`)
- **React 19** with TypeScript + Vite
- **CodeMirror 6** with @replit/codemirror-vim for vim-mode editor
- **Tailwind CSS** with Catppuccin Mocha theme
- Heavy components (ResultTable, ResultJson, modals) are lazy-loaded via `React.lazy()` + `Suspense`
- Vite splits vendor chunks: `codemirror` and `table` (tanstack)

#### Components (`src/components/`)
- `Editor.tsx` — CodeMirror editor with vim mode, autocomplete (collections, query methods, aggregation stages)
- `ResultsPanel.tsx` — Orchestrates result views (table/json/detail), handles document save
- `ResultTable.tsx` — TanStack Table with vim-style j/k/h/l/g/G/Enter navigation
- `ResultJson.tsx` — Raw JSON result view
- `VimJsonEditor.tsx` — Vim editor for document detail view (:w save, :q back)
- `CommandPalette.tsx` — Fuzzy command palette
- `ConnectionModal.tsx` — Add/select/delete MongoDB connections
- `ListModal.tsx` — Reusable list picker (databases, collections, query files)
- `KeymapModal.tsx` — Keybinding help overlay
- `StatusBar.tsx` — Top bar showing connection, db, file, leader state

#### Hooks (`src/hooks/`)
- `useMongoConnection.ts` — Connection state, database/collection listing
- `useQueryExecution.ts` — Query execution and pagination
- `usePanelFocus.ts` — Panel focus (editor/results), layout mode, maximize toggle

#### Utilities (`src/lib/`)
- `keybindings.ts` — Keybinding definitions, merge logic, key matching
- `tauri-commands.ts` — Typed wrappers around Tauri IPC `invoke()` calls
- `vim-commands.ts` — Custom vim ex-commands (:w, :q, :wqa)

### Backend (`src-tauri/src/`)
- **Tauri v2** with Rust
- **MongoDB Rust Driver** for database operations

#### Commands (`src-tauri/src/commands/`)
- `query.rs` — Query parsing and execution (find, aggregate, update, delete, insert, distinct, etc.). Has unit tests.
- `connection.rs` — Connection CRUD, database/collection listing
- `files.rs` — Query file save/load from `~/.config/mogy/queries/`
- `metadata.rs` — Collection metadata (field names for autocomplete)

#### Config (`src-tauri/src/config/`)
- `connections.rs` — Connection persistence (`~/.config/mogy/connections.json`)
- `session.rs` — Session state persistence (`~/.config/mogy/session.json`)
- `settings.rs` — User settings loader (`~/.config/mogy/settings.json`)

#### Database (`src-tauri/src/db/`)
- `client.rs` — MongoDB client state management (lazy connection)

### Key Patterns
- Global keyboard handler in `App.tsx` uses capture phase — all keybindings defined in `keybindings.ts` and overridable via settings
- Leader key pattern: `Ctrl+Space` then a follow-up key within 1s timeout
- Refs used extensively to avoid stale closures in event handlers
- Modals are lazy-loaded and only rendered when their `isOpen` state is true

## Configuration

- `src-tauri/tauri.conf.json` — Tauri window config, bundling, window starts hidden (avoids white flash)
- `src-tauri/Cargo.toml` — Rust dependencies
- `package.json` — Node dependencies (bun)
- `vite.config.ts` — Vite config with manual chunk splitting (codemirror, table)
- User settings: `~/.config/mogy/settings.json` — keybinding overrides, layout direction
