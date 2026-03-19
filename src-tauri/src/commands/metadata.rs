use crate::db::client::{FieldCacheEntry, MongoState};
use mongodb::bson::doc;
use mongodb::Client;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;
use tauri::State;

#[tauri::command]
pub async fn list_databases(state: State<'_, MongoState>) -> Result<Vec<String>, String> {
    let client = state.get_client().await?;
    client
        .list_database_names()
        .await
        .map_err(|e| format!("Failed to list databases: {}", e))
}

#[tauri::command]
pub async fn list_collections(
    db: String,
    state: State<'_, MongoState>,
) -> Result<Vec<String>, String> {
    let client = state.get_client().await?;
    client
        .database(&db)
        .list_collection_names()
        .await
        .map_err(|e| format!("Failed to list collections: {}", e))
}

/// Extract field names from a BSON document recursively
/// Produces dot-notation paths: "name", "address.city", etc.
/// Caps depth at 3 levels, max 500 fields
fn extract_fields(doc: &mongodb::bson::Document, prefix: &str, depth: u8, fields: &mut Vec<String>, max_depth: u8, max_fields: usize) {
    if depth > max_depth || fields.len() >= max_fields {
        return;
    }

    for (key, value) in doc.iter() {
        let full_key = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{}.{}", prefix, key)
        };

        // Always include _id as a default field
        if key == "_id" && !fields.contains(&"_id".to_string()) {
            fields.push("_id".to_string());
        } else if !fields.contains(key) {
            // Also add simple field name for autocomplete
            fields.push(key.clone());
        }

        if !fields.contains(&full_key) {
            fields.push(full_key.clone());
        }

        // Recurse into nested documents
        if let Some(nested) = value.as_document() {
            extract_fields(nested, &full_key, depth + 1, fields, max_depth, max_fields);
        }

        // Recurse into first element of arrays of documents
        if let Some(arr) = value.as_array() {
            if let Some(first) = arr.first() {
                if let Some(nested) = first.as_document() {
                    extract_fields(nested, &full_key, depth + 1, fields, max_depth, max_fields);
                }
            }
        }
    }
}

#[tauri::command]
pub async fn list_collection_fields(
    db: String,
    collection: String,
    state: State<'_, MongoState>,
) -> Result<Vec<String>, String> {
    let key = format!("{}.{}", db, collection);

    // Check if we have a valid cache entry
    {
        let cache = state.field_cache.lock().await;
        if let Some(entry) = cache.get(&key) {
            if entry.fetched_at.elapsed() < std::time::Duration::from_secs(24 * 60 * 60) {
                // Cache is valid - return immediately
                return Ok(entry.fields.clone());
            }
            // Cache is stale - we'll return stale data but spawn background refresh
            let stale_fields = entry.fields.clone();
            // Clone the data we need for the background task
            let client_arc = state.client.clone();
            let field_cache_arc = state.field_cache.clone();
            let key_clone = key.clone();
            let db_clone = db.clone();
            let coll_clone = collection.clone();

            // Spawn background refresh (fire and forget)
            tokio::spawn(async move {
                let client = client_arc.lock().await;
                if let Some(client) = client.as_ref() {
                    let result = client
                        .database(&db_clone)
                        .collection(&coll_clone)
                        .find_one(doc! {})
                        .await;

                    if let Ok(Some(doc)) = result {
                        let mut fields = vec!["_id".to_string()];
                        extract_fields(&doc, "", 0, &mut fields, 3, 500);
                        let mut cache = field_cache_arc.lock().await;
                        cache.insert(
                            key_clone,
                            FieldCacheEntry {
                                fields,
                                fetched_at: Instant::now(),
                            },
                        );
                    }
                }
            });

            return Ok(stale_fields);
        }
    }

    // No cache entry - fetch synchronously
    let client = state.get_client().await?;
    let doc = client
        .database(&db)
        .collection(&collection)
        .find_one(doc! {})
        .await
        .map_err(|e| format!("Failed to get sample document: {}", e))?;

    let mut fields = vec!["_id".to_string()];

    if let Some(d) = doc {
        extract_fields(&d, "", 0, &mut fields, 3, 500);
    }

    // Cache the result
    let mut cache = state.field_cache.lock().await;
    cache.insert(
        key,
        FieldCacheEntry {
            fields: fields.clone(),
            fetched_at: Instant::now(),
        },
    );

    Ok(fields)
}

#[tauri::command]
pub async fn refresh_all_collection_fields(
    db: String,
    state: State<'_, MongoState>,
) -> Result<(), String> {
    let client = state.get_client().await?;
    let collections = client
        .database(&db)
        .list_collection_names()
        .await
        .map_err(|e| format!("Failed to list collections: {}", e))?;

    // Clone the data we need for the background task
    let client_arc = state.client.clone();
    let field_cache_arc = state.field_cache.clone();
    let db_clone = db.clone();

    // Fire and forget - spawn background task to refresh all
    tokio::spawn(async move {
        let client_guard = client_arc.lock().await;
        if let Some(client) = client_guard.as_ref() {
            for coll in collections {
                let key = format!("{}.{}", db_clone, coll);
                let result = client
                    .database(&db_clone)
                    .collection(&coll)
                    .find_one(doc! {})
                    .await;

                if let Ok(Some(doc)) = result {
                    let mut fields = vec!["_id".to_string()];
                    extract_fields(&doc, "", 0, &mut fields, 3, 500);
                    let mut cache = field_cache_arc.lock().await;
                    cache.insert(
                        key,
                        FieldCacheEntry {
                            fields,
                            fetched_at: Instant::now(),
                        },
                    );
                }
            }
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::doc;

    #[test]
    fn test_extract_fields_nested() {
        let doc = doc! {
            "name": "John",
            "address": {
                "city": "NYC",
                "zip": "10001"
            },
            "orders": [
                { "item": "A", "qty": 1 },
                { "item": "B", "qty": 2 }
            ]
        };

        let mut fields = vec!["_id".to_string()];
        extract_fields(&doc, "", 0, &mut fields, 3, 500);

        // Should include _id
        assert!(fields.contains(&"_id".to_string()));
        // Should include top-level fields
        assert!(fields.contains(&"name".to_string()));
        // Should include nested fields with dot notation
        assert!(fields.contains(&"address.city".to_string()));
        assert!(fields.contains(&"address.zip".to_string()));
        // Should include array element fields
        assert!(fields.contains(&"orders.item".to_string()));
        assert!(fields.contains(&"orders.qty".to_string()));
    }

    #[test]
    fn test_extract_fields_depth_limit() {
        let doc = doc! {
            "a": {
                "b": {
                    "c": {
                        "d": "deep"
                    }
                }
            }
        };

        let mut fields = vec![];
        // max_depth=2 means we can add keys at depth 0, 1, 2 (but not recurse beyond 2)
        extract_fields(&doc, "", 0, &mut fields, 2, 500);

        // Should include a and a.b (depth 0, 1)
        assert!(fields.contains(&"a".to_string()));
        assert!(fields.contains(&"a.b".to_string()));
        // At depth 2, we still add a.b.c but don't recurse to a.b.c.d
        assert!(fields.contains(&"a.b.c".to_string()));
        // Should NOT include a.b.c.d because we stop recursing at depth 3
        assert!(!fields.contains(&"a.b.c.d".to_string()));
    }
}
