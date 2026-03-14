# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mogy is a keyboard-driven MongoDB query UI with first-class Vim support. Built with Tauri v2 + React + CodeMirror.

## Commands

```bash
# Install dependencies
bun install

# Development
bun run tauri dev

# Run Rust tests
cd src-tauri && cargo test

# Build production
bun run tauri build
```

## Architecture

### Frontend (`src/`)
- **React 19** with TypeScript + Vite
- **CodeMirror 6** with @replit/codemirror-vim for vim-mode editor
- **Tailwind CSS** with Catppuccin Mocha theme
- Components in `src/components/`, hooks in `src/hooks/`, utilities in `src/lib/`

### Backend (`src-tauri/src/`)
- **Tauri v2** with Rust
- **MongoDB Rust Driver** for database operations
- Modules: `commands/` (Tauri IPC handlers), `config/` (settings, connections, session), `db/` (MongoDB client management)

### Key Rust Files
- `src-tauri/src/lib.rs` - Main app entry, registers Tauri commands
- `src-tauri/src/commands/` - IPC handlers (connection, query, files, metadata)
- `src-tauri/src/db/client.rs` - MongoDB client state management

## Configuration

- `src-tauri/tauri.conf.json` - Tauri window config, bundling settings
- `src-tauri/Cargo.toml` - Rust dependencies
- `package.json` - Node dependencies
- User settings: `~/.config/mogy/settings.json`
