use mongodb::Client;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const FIELD_CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60); // 24 hours

#[derive(Clone)]
pub struct FieldCacheEntry {
    pub fields: Vec<String>,
    pub fetched_at: Instant,
}

pub struct MongoState {
    pub client: Arc<Mutex<Option<Client>>>,
    pub active_connection: Arc<Mutex<Option<String>>>,
    pub field_cache: Arc<Mutex<HashMap<String, FieldCacheEntry>>>,
}

impl MongoState {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
            active_connection: Arc::new(Mutex::new(None)),
            field_cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn connect(&self, uri: &str, name: &str) -> Result<(), String> {
        let client = Client::with_uri_str(uri)
            .await
            .map_err(|e| format!("Failed to connect: {}", e))?;

        // Test connection by listing databases
        client
            .list_database_names()
            .await
            .map_err(|e| format!("Connection test failed: {}", e))?;

        *self.client.lock().await = Some(client);
        *self.active_connection.lock().await = Some(name.to_string());
        Ok(())
    }

    pub async fn disconnect(&self) {
        *self.client.lock().await = None;
        *self.active_connection.lock().await = None;
        // Clear field cache on disconnect
        self.field_cache.lock().await.clear();
    }

    pub fn is_cache_valid(entry: &FieldCacheEntry) -> bool {
        entry.fetched_at.elapsed() < FIELD_CACHE_TTL
    }

    pub async fn get_cached_fields(&self, key: &str) -> Option<Vec<String>> {
        let cache = self.field_cache.lock().await;
        cache.get(key).and_then(|entry| {
            if Self::is_cache_valid(entry) {
                Some(entry.fields.clone())
            } else {
                None
            }
        })
    }

    pub async fn set_cached_fields(&self, key: String, fields: Vec<String>) {
        let mut cache = self.field_cache.lock().await;
        cache.insert(
            key,
            FieldCacheEntry {
                fields,
                fetched_at: Instant::now(),
            },
        );
    }

    pub async fn get_client(&self) -> Result<Client, String> {
        self.client
            .lock()
            .await
            .clone()
            .ok_or_else(|| "Not connected to any database".to_string())
    }
}
