use mongodb::Client;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

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

    pub async fn get_client(&self) -> Result<Client, String> {
        self.client
            .lock()
            .await
            .clone()
            .ok_or_else(|| "Not connected to any database".to_string())
    }
}
