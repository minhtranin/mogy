use mongodb::Client;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct MongoState {
    pub client: Arc<Mutex<Option<Client>>>,
    pub active_connection: Arc<Mutex<Option<String>>>,
}

impl MongoState {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
            active_connection: Arc::new(Mutex::new(None)),
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
    }

    pub async fn get_client(&self) -> Result<Client, String> {
        self.client
            .lock()
            .await
            .clone()
            .ok_or_else(|| "Not connected to any database".to_string())
    }
}
