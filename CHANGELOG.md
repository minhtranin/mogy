# Changelog

## [2026.22.3] - 2026-03-22

### Features
- **Comprehensive MongoDB operator autocomplete**: Added all MongoDB operators to `$` autocomplete — comparison, logical, element, evaluation, array, string, date, type conversion, accumulators, update operators, pipeline stages, and conditionals
- **Fuzzy collection matching** (mogy-ai): Replaced custom Jaccard+substring matching with `sahilm/fuzzy` for more accurate collection identification, ranked by score, capped at 5

### Bug Fixes
- **Stale closure in AI query flow**: `handleRunQuery` captured empty collections from initial render — fixed with `mongoRef.current` for fresh values
- **Session merge overwrites**: Layout direction, color scheme, and other settings were wiped when connection hook saved session — now merges instead of full overwrite

### Performance
- **Deduplicated session load**: `loadSettings` + `loadSession` now run in a single parallel `Promise.all` — removed duplicate `loadSession` IPC call
- **Deferred update check**: Updater check delayed 5s after startup to avoid competing with app initialization

### Other
- `:qa` vim command — save and quit (same as `:wqa`)
- `Ctrl+Space q` leader shortcut — save and quit
- "Save and Quit" command palette item

## [2026.20.3] - 2026-03-20

### Features
- **Per-connection session cache**: Databases and collections are now cached per connection name, so switching between multiple connections preserves cached data for each
- **Field cache persistence**: Collection fields are now saved to session file and restored on startup — autocomplete works immediately without waiting for re-fetch
- **Ctrl+R in collections popup**: Refreshes field cache for all collections in the current database and saves to session instantly
- **Ctrl+N in editor**: Opens autocomplete immediately inside `{}` to show field suggestions; navigates down if popup already open
- **Field autocomplete loading state**: Shows "loading fields..." while fetching, then auto-refreshes popup when fields arrive

### Bug Fixes
- **Field cache stale closure**: `selectedDb` was captured as `null` at editor mount — fixed with a ref so fields are always fetched against the current database
- **`<think>` block stripping** (mogy-ai): Fixed wrong string used for offset calculation, corrupting query output
- **Non-MongoDB prompt handling** (mogy-ai): Unrelated prompts now return a friendly hint instead of a 400 error

### Performance
- **Parallel field fetching**: `refresh_all_collection_fields` now fetches 5 collections concurrently using a semaphore + JoinSet instead of sequentially
- **No auto field refresh on connect**: Fields are only refreshed explicitly via Ctrl+R — startup is faster and avoids unnecessary MongoDB queries when cache exists
- **Stale collection pruning**: After Ctrl+R, deleted collections are removed from the field cache

## [0.1.2] - 2026-03-19

### Features
- **Session caching**: Instant startup with cached databases/collections
- **Field-level autocomplete**: Fields suggested when typing inside `{}` based on detected collection
- **Vite proxy**: AI service proxy to avoid CORS issues

### Bug Fixes
- **UpdateOne/UpdateMany/ReplaceOne**: Fixed filter not being applied (was matching all documents)
- **Help popup**: `?` key now only shows help when editor is not focused

### Performance
- Optimized autocomplete brace scanning (limited to 500 chars)
- Lazy collection detection from cursor position
- Fire-and-forget field fetching

## [0.1.1] - Previous release
