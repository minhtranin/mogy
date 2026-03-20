# Changelog

## [Unreleased] - 2026-03-20

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
