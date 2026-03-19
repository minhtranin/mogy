# Changelog

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
