# Mogy

A keyboard-driven MongoDB query UI with first-class Vim support.

Built with Tauri v2 + React + CodeMirror.

<p align="center">
  <img src="./mogy.png" alt="Mogy" width="200" />
</p>

## Features

- **First-class Vim support** — Full vim mode in the editor with `jk` to exit insert mode, `:w` to save, `:wqa` to save and quit
- **Keyboard-driven** — Navigate everything with `j/k`, `h/l`, `g/G`, and leader key (`Ctrl+Space`)
- **Query execution** — Run MongoDB queries: `.find()`, `.aggregate()`, `.updateMany()`, `.count()`, etc.
- **Autocomplete** — Collection names and query methods (`.find`, `.aggregate`, `.updateMany`, ...) are suggested as you type
- **Command palette** — Quick access to all actions via `Ctrl+Space p`
- **Connection management** — Save and manage multiple MongoDB connections
- **Session persistence** — Remembers your last connection, database, collection, and editor content
- **Query files** — Save/load query scripts for reuse

## Keybindings

| Key | Action |
|-----|--------|
| `Ctrl+Enter` | Run query |
| `Ctrl+K` / `Ctrl+H` | Focus editor |
| `Ctrl+J` / `Ctrl+L` | Focus results |
| `Ctrl+N` / `Ctrl+P` | Next / previous page |
| `Ctrl+Shift+N` | Last page |
| `Ctrl+Shift+P` | First page |
| `Shift+H` | Table view |
| `Shift+L` | JSON view |
| `?` | Show help |
| `Ctrl+Space` then... | **Leader key** |
| `a` | Open connections |
| `d` | Open databases |
| `o` | Open collections |
| `m` | Toggle maximize |
| `l` | Load query file |
| `c` | New query file |
| `p` | Command palette |
| `Enter` | Toggle fullscreen |

### Vim Editor

- `jk` — Exit insert mode
- `:w` — Save query file
- `:q` — Close detail view
- `:wqa` — Save and quit app

### Results Panel

- `j` / `k` — Navigate rows
- `h` / `l` — Scroll horizontal
- `g` / `G` — First / last row
- `Enter` — Expand row detail

## Configuration

All settings live in `~/.config/mogy/settings.json`. Create the file to override defaults — only specify keys you want to change.

```jsonc
{
  "keybindings": {
    "runQuery": "ctrl+Enter",
    "focusEditor": "ctrl+k",
    "focusEditorAlt": "ctrl+h",
    "focusResults": "ctrl+j",
    "focusResultsAlt": "ctrl+l",
    "nextPage": "ctrl+n",
    "prevPage": "ctrl+p",
    "firstPage": "ctrl+shift+p",
    "lastPage": "ctrl+shift+n",
    "tableView": "shift+h",
    "jsonView": "shift+l",
    "showHelp": "?",
    "leader": "ctrl+space",
    "leader.connections": "a",
    "leader.databases": "d",
    "leader.collections": "o",
    "leader.maximize": "m",
    "leader.loadFile": "l",
    "leader.newFile": "c",
    "leader.commandPalette": "p",
    "leader.fullscreen": "Enter"
  }
}
```

## Development

```bash
# Install dependencies
bun install

# Run in dev mode
bun run tauri dev

# Build production
bun run tauri build
```

### Running Tests

Rust backend tests:

```bash
cd src-tauri && cargo test
```

Run with output for debugging:

```bash
cd src-tauri && cargo test -- --nocapture
```

Run a specific test:

```bash
cd src-tauri && cargo test test_name
```

Check test coverage (requires `cargo-tarpaulin`):

```bash
cd src-tauri && cargo tarpaulin --out html
# Opens htmlcov in target/tarpaulin/tarpaulin-report.html
```

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Backend**: Rust + Tauri v2
- **Editor**: CodeMirror 6 + @replit/codemirror-vim
- **Database**: MongoDB Rust Driver
- **UI**: Tailwind CSS (Catppuccin Mocha theme)

## License

MIT
