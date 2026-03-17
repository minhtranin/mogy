use crate::db::client::MongoState;
use mongodb::bson::{self, doc, oid::ObjectId, Document};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum QueryType {
    Find,
    Aggregate,
    Count,
    DeleteOne,
    DeleteMany,
    InsertOne,
    InsertMany,
    UpdateOne,
    UpdateMany,
    ReplaceOne,
    Distinct,
    FindOne,
    FindOneAndUpdate,
    FindOneAndDelete,
    FindOneAndReplace,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryRequest {
    pub db: String,
    pub collection: String,
    pub query_type: QueryType,
    pub filter: Option<serde_json::Value>,
    pub pipeline: Option<Vec<serde_json::Value>>,
    pub page: Option<u64>,
    pub page_size: Option<u64>,
    pub sort: Option<serde_json::Value>,
    pub projection: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryResult {
    pub documents: Vec<serde_json::Value>,
    pub has_more: bool,
    pub query_type: QueryType,
    pub page: u64,
    pub page_size: u64,
}

/// Convert serde_json::Value to bson::Bson, handling extended JSON patterns
/// like {"$oid": "..."} → ObjectId, {"$numberLong": "..."} → Int64, etc.
fn json_value_to_bson(val: &serde_json::Value) -> bson::Bson {
    match val {
        serde_json::Value::Object(map) => {
            if map.len() == 1 {
                if let Some(oid_str) = map.get("$oid").and_then(|v| v.as_str()) {
                    if let Ok(oid) = ObjectId::parse_str(oid_str) {
                        return bson::Bson::ObjectId(oid);
                    }
                }
                if let Some(date_val) = map.get("$date") {
                    if let Some(millis) = date_val.as_i64() {
                        return bson::Bson::DateTime(bson::DateTime::from_millis(millis));
                    }
                    if let Some(s) = date_val.as_str() {
                        if let Ok(dt) = bson::DateTime::parse_rfc3339_str(s) {
                            return bson::Bson::DateTime(dt);
                        }
                    }
                    if let Some(obj) = date_val.as_object() {
                        if let Some(millis) = obj
                            .get("$numberLong")
                            .and_then(|v| v.as_str())
                            .and_then(|s| s.parse::<i64>().ok())
                        {
                            return bson::Bson::DateTime(bson::DateTime::from_millis(millis));
                        }
                    }
                }
                if let Some(s) = map.get("$numberLong").and_then(|v| v.as_str()) {
                    if let Ok(n) = s.parse::<i64>() {
                        return bson::Bson::Int64(n);
                    }
                }
                if let Some(s) = map.get("$numberInt").and_then(|v| v.as_str()) {
                    if let Ok(n) = s.parse::<i32>() {
                        return bson::Bson::Int32(n);
                    }
                }
                if let Some(s) = map.get("$numberDouble").and_then(|v| v.as_str()) {
                    if let Ok(n) = s.parse::<f64>() {
                        return bson::Bson::Double(n);
                    }
                }
                if let Some(s) = map.get("$numberDecimal").and_then(|v| v.as_str()) {
                    if let Ok(d) = s.parse::<bson::Decimal128>() {
                        return bson::Bson::Decimal128(d);
                    }
                }
            }
            let doc: Document = map
                .iter()
                .map(|(k, v)| (k.clone(), json_value_to_bson(v)))
                .collect();
            bson::Bson::Document(doc)
        }
        serde_json::Value::Array(arr) => {
            bson::Bson::Array(arr.iter().map(json_value_to_bson).collect())
        }
        serde_json::Value::String(s) => bson::Bson::String(s.clone()),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                if i >= i32::MIN as i64 && i <= i32::MAX as i64 {
                    bson::Bson::Int32(i as i32)
                } else {
                    bson::Bson::Int64(i)
                }
            } else if let Some(f) = n.as_f64() {
                bson::Bson::Double(f)
            } else {
                bson::Bson::Double(0.0)
            }
        }
        serde_json::Value::Bool(b) => bson::Bson::Boolean(*b),
        serde_json::Value::Null => bson::Bson::Null,
    }
}

fn json_to_bson_doc(val: &serde_json::Value) -> Result<Document, String> {
    match json_value_to_bson(val) {
        bson::Bson::Document(doc) => Ok(doc),
        _ => Err("Expected a document".to_string()),
    }
}

/// Preprocess MongoDB shell helpers like ObjectId('...'), new Date('...'), ISODate('...')
/// into extended JSON that json5 can parse.
fn preprocess_mongo_helpers(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Check for ObjectId('...')
        if i + 9 <= len && &input[i..i + 9] == "ObjectId(" {
            if let Some((value, end)) = extract_helper_arg(&chars, i + 9) {
                result.push_str(&format!(r#"{{"$oid":"{}"}}"#, value));
                i = end;
                continue;
            }
        }
        // Check for new Date('...')
        if i + 9 <= len && &input[i..i + 9] == "new Date(" {
            if let Some((value, end)) = extract_helper_arg(&chars, i + 9) {
                result.push_str(&format!(r#"{{"$date":"{}"}}"#, value));
                i = end;
                continue;
            }
        }
        // Check for ISODate('...')
        if i + 8 <= len && &input[i..i + 8] == "ISODate(" {
            if let Some((value, end)) = extract_helper_arg(&chars, i + 8) {
                result.push_str(&format!(r#"{{"$date":"{}"}}"#, value));
                i = end;
                continue;
            }
        }
        // Check for NumberLong('...')
        if i + 11 <= len && &input[i..i + 11] == "NumberLong(" {
            if let Some((value, end)) = extract_helper_arg(&chars, i + 11) {
                result.push_str(&format!(r#"{{"$numberLong":"{}"}}"#, value));
                i = end;
                continue;
            }
        }
        // Check for Long('...')
        if i + 5 <= len && &input[i..i + 5] == "Long(" {
            if let Some((value, end)) = extract_helper_arg(&chars, i + 5) {
                result.push_str(&format!(r#"{{"$numberLong":"{}"}}"#, value));
                i = end;
                continue;
            }
        }
        // Check for NumberDecimal('...')
        if i + 14 <= len && &input[i..i + 14] == "NumberDecimal(" {
            if let Some((value, end)) = extract_helper_arg(&chars, i + 14) {
                result.push_str(&format!(r#"{{"$numberDecimal":"{}"}}"#, value));
                i = end;
                continue;
            }
        }
        result.push(chars[i]);
        i += 1;
    }
    result
}

/// Extract the string argument from a helper call like ('...') or ("...")
/// Returns (value, position after closing paren)
fn extract_helper_arg(chars: &[char], start: usize) -> Option<(String, usize)> {
    let mut i = start;
    // Skip whitespace
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    if i >= chars.len() {
        return None;
    }

    let quote = chars[i];
    if quote != '\'' && quote != '"' {
        return None;
    }
    i += 1;

    let mut value = String::new();
    while i < chars.len() && chars[i] != quote {
        value.push(chars[i]);
        i += 1;
    }
    if i >= chars.len() {
        return None;
    }
    i += 1; // skip closing quote

    // Skip whitespace and closing paren
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    if i < chars.len() && chars[i] == ')' {
        Some((value, i + 1))
    } else {
        None
    }
}

/// Convert a BSON document to serde_json::Value with dates as ISO strings
fn bson_doc_to_json(doc: &Document) -> serde_json::Value {
    let map: serde_json::Map<String, serde_json::Value> = doc
        .iter()
        .map(|(k, v)| (k.clone(), bson_to_json_value(v)))
        .collect();
    serde_json::Value::Object(map)
}

fn bson_to_json_value(val: &bson::Bson) -> serde_json::Value {
    match val {
        bson::Bson::DateTime(dt) => {
            match dt.try_to_rfc3339_string() {
                Ok(s) => serde_json::json!({"$date": s}),
                Err(_) => serde_json::json!({"$date": dt.timestamp_millis()}),
            }
        }
        bson::Bson::ObjectId(oid) => {
            serde_json::json!({"$oid": oid.to_hex()})
        }
        bson::Bson::Document(doc) => bson_doc_to_json(doc),
        bson::Bson::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(bson_to_json_value).collect())
        }
        bson::Bson::String(s) => serde_json::Value::String(s.clone()),
        bson::Bson::Boolean(b) => serde_json::Value::Bool(*b),
        bson::Bson::Null => serde_json::Value::Null,
        bson::Bson::Int32(n) => serde_json::json!(n),
        bson::Bson::Int64(n) => serde_json::json!({"$numberLong": n.to_string()}),
        bson::Bson::Double(f) => serde_json::json!(f),
        bson::Bson::Decimal128(d) => serde_json::json!({"$numberDecimal": d.to_string()}),
        // Fall back to default serialization for other types
        other => serde_json::to_value(other).unwrap_or(serde_json::Value::Null),
    }
}

#[tauri::command]
pub async fn execute_query(
    request: QueryRequest,
    state: State<'_, MongoState>,
) -> Result<QueryResult, String> {
    let client = state.get_client().await?;
    let collection = client
        .database(&request.db)
        .collection::<Document>(&request.collection);

    match request.query_type {
        QueryType::Find => {
            let filter = match &request.filter {
                Some(f) => json_to_bson_doc(f)?,
                None => doc! {},
            };

            let page = request.page.unwrap_or(1);
            let page_size = request.page_size.unwrap_or(20);
            let skip = (page - 1) * page_size;

            // Fetch one extra to detect if there are more pages
            let mut find = collection.find(filter).skip(skip).limit((page_size + 1) as i64);

            if let Some(sort_val) = &request.sort {
                find = find.sort(json_to_bson_doc(sort_val)?);
            }

            if let Some(proj_val) = &request.projection {
                find = find.projection(json_to_bson_doc(proj_val)?);
            }

            let mut cursor = find.await.map_err(|e| format!("Find failed: {}", e))?;

            let mut documents = Vec::new();
            while cursor
                .advance()
                .await
                .map_err(|e| format!("Cursor error: {}", e))?
            {
                let doc = cursor
                    .deserialize_current()
                    .map_err(|e| format!("Deserialize error: {}", e))?;
                documents.push(bson_doc_to_json(&doc));
            }

            let has_more = documents.len() > page_size as usize;
            if has_more {
                documents.pop();
            }

            Ok(QueryResult {
                documents,
                has_more,
                query_type: QueryType::Find,
                page,
                page_size,
            })
        }
        QueryType::Aggregate => {
            let pipeline: Vec<Document> = match &request.pipeline {
                Some(stages) => stages
                    .iter()
                    .map(|s| json_to_bson_doc(s))
                    .collect::<Result<Vec<_>, _>>()?,
                None => vec![],
            };

            let page = request.page.unwrap_or(1);
            let page_size = request.page_size.unwrap_or(20);
            let skip = (page - 1) * page_size;

            // Check if pipeline already has $limit stage
            let has_limit = pipeline.iter().any(|doc| {
                doc.keys().any(|k| k == "$limit")
            });

            // Build pipeline with skip and limit
            let mut full_pipeline = pipeline.clone();
            full_pipeline.push(doc! { "$skip": skip as i64 });

            // Fetch one extra to detect if there are more pages
            if !has_limit {
                full_pipeline.push(doc! { "$limit": (page_size + 1) as i64 });
            }

            let mut cursor = collection
                .aggregate(full_pipeline)
                .await
                .map_err(|e| format!("Aggregate failed: {}", e))?;

            let mut documents = Vec::new();
            while cursor
                .advance()
                .await
                .map_err(|e| format!("Cursor error: {}", e))?
            {
                let doc = cursor
                    .deserialize_current()
                    .map_err(|e| format!("Deserialize error: {}", e))?;
                documents.push(bson_doc_to_json(&doc));
            }

            let has_more = !has_limit && documents.len() > page_size as usize;
            if has_more {
                documents.pop();
            }

            Ok(QueryResult {
                documents,
                has_more,
                query_type: QueryType::Aggregate,
                page,
                page_size,
            })
        }
        QueryType::Count => {
            let filter = match &request.filter {
                Some(f) => json_to_bson_doc(f)?,
                None => doc! {},
            };

            let count = collection
                .count_documents(filter)
                .await
                .map_err(|e| format!("Count failed: {}", e))?;

            Ok(QueryResult {
                documents: vec![serde_json::json!({ "count": count })],
                has_more: false,
                query_type: QueryType::Count,
                page: 1,
                page_size: 1,
            })
        }
        QueryType::DeleteOne => {
            let filter = match &request.filter {
                Some(f) => json_to_bson_doc(f)?,
                None => doc! {},
            };

            let result = collection
                .delete_one(filter)
                .await
                .map_err(|e| format!("DeleteOne failed: {}", e))?;

            Ok(QueryResult {
                documents: vec![serde_json::json!({
                    "acknowledged": true,
                    "deletedCount": result.deleted_count,
                    "insertedId": null,
                    "insertedCount": 0,
                    "matchedCount": 0,
                    "modifiedCount": 0,
                    "upsertedId": null,
                    "upsertedCount": 0
                })],
                has_more: false,
                query_type: QueryType::DeleteOne,
                page: 1,
                page_size: 1,
            })
        }
        QueryType::DeleteMany => {
            let filter = match &request.filter {
                Some(f) => json_to_bson_doc(f)?,
                None => doc! {},
            };

            let result = collection
                .delete_many(filter)
                .await
                .map_err(|e| format!("DeleteMany failed: {}", e))?;

            Ok(QueryResult {
                documents: vec![serde_json::json!({
                    "acknowledged": true,
                    "deletedCount": result.deleted_count,
                    "insertedId": null,
                    "insertedCount": 0,
                    "matchedCount": 0,
                    "modifiedCount": 0,
                    "upsertedId": null,
                    "upsertedCount": 0
                })],
                has_more: false,
                query_type: QueryType::DeleteMany,
                page: 1,
                page_size: 1,
            })
        }
        QueryType::InsertOne => {
            let doc_val = match &request.projection {
                Some(d) => json_to_bson_doc(d)?,
                None => return Err("InsertOne requires a document".to_string()),
            };

            let result = collection
                .insert_one(doc_val)
                .await
                .map_err(|e| format!("InsertOne failed: {}", e))?;

            Ok(QueryResult {
                documents: vec![serde_json::json!({
                    "acknowledged": true,
                    "insertedId": bson_to_json_value(&result.inserted_id),
                    "insertedCount": 1,
                    "matchedCount": 0,
                    "modifiedCount": 0,
                    "deletedCount": 0,
                    "upsertedId": null,
                    "upsertedCount": 0
                })],
                has_more: false,
                query_type: QueryType::InsertOne,
                page: 1,
                page_size: 1,
            })
        }
        QueryType::InsertMany => {
            let docs_val: Vec<Document> = match &request.projection {
                Some(d) => {
                    if let Some(arr) = d.as_array() {
                        arr.iter()
                            .map(|v| json_to_bson_doc(v))
                            .collect::<Result<Vec<_>, _>>()?
                    } else {
                        vec![json_to_bson_doc(d)?]
                    }
                }
                None => return Err("InsertMany requires documents".to_string()),
            };

            let result = collection
                .insert_many(docs_val)
                .await
                .map_err(|e| format!("InsertMany failed: {}", e))?;

            let inserted_ids: Vec<serde_json::Value> = result
                .inserted_ids
                .values()
                .map(|id| serde_json::to_value(id).unwrap_or(serde_json::Value::Null))
                .collect();

            Ok(QueryResult {
                documents: vec![serde_json::json!({
                    "acknowledged": true,
                    "insertedIds": inserted_ids,
                    "insertedCount": inserted_ids.len(),
                    "matchedCount": 0,
                    "modifiedCount": 0,
                    "deletedCount": 0,
                    "upsertedId": null,
                    "upsertedCount": 0
                })],
                has_more: false,
                query_type: QueryType::InsertMany,
                page: 1,
                page_size: inserted_ids.len() as u64,
            })
        }
        QueryType::UpdateOne => {
            let filter = match &request.filter {
                Some(f) => json_to_bson_doc(f)?,
                None => doc! {},
            };
            let update = match &request.pipeline {
                Some(p) => {
                    // Extract $set from pipeline
                    p.iter()
                        .find_map(|stage| stage.get("$set"))
                        .map(|v| json_to_bson_doc(v))
                        .transpose()?
                        .unwrap_or(doc! {})
                }
                None => doc! {},
            };

            let result = collection
                .update_one(filter, update)
                .await
                .map_err(|e| format!("UpdateOne failed: {}", e))?;

            let upserted_count = if result.upserted_id.is_some() { 1 } else { 0 };
            let upserted_id_json = result.upserted_id.as_ref().map(|id| bson_to_json_value(id));

            Ok(QueryResult {
                documents: vec![serde_json::json!({
                    "acknowledged": true,
                    "matchedCount": result.matched_count,
                    "modifiedCount": result.modified_count,
                    "upsertedId": upserted_id_json,
                    "upsertedCount": upserted_count,
                    "insertedId": null,
                    "insertedCount": 0,
                    "deletedCount": 0
                })],
                has_more: false,
                query_type: QueryType::UpdateOne,
                page: 1,
                page_size: 1,
            })
        }
        QueryType::UpdateMany => {
            let filter = match &request.filter {
                Some(f) => json_to_bson_doc(f)?,
                None => doc! {},
            };
            let update = match &request.pipeline {
                Some(p) => {
                    p.iter()
                        .find_map(|stage| stage.get("$set"))
                        .map(|v| json_to_bson_doc(v))
                        .transpose()?
                        .unwrap_or(doc! {})
                }
                None => doc! {},
            };

            let result = collection
                .update_many(filter, update)
                .await
                .map_err(|e| format!("UpdateMany failed: {}", e))?;

            let upserted_count = if result.upserted_id.is_some() { 1 } else { 0 };
            let upserted_id_json = result.upserted_id.as_ref().map(|id| bson_to_json_value(id));

            Ok(QueryResult {
                documents: vec![serde_json::json!({
                    "acknowledged": true,
                    "matchedCount": result.matched_count,
                    "modifiedCount": result.modified_count,
                    "upsertedId": upserted_id_json,
                    "upsertedCount": upserted_count,
                    "insertedId": null,
                    "insertedCount": 0,
                    "deletedCount": 0
                })],
                has_more: false,
                query_type: QueryType::UpdateMany,
                page: 1,
                page_size: 1,
            })
        }
        QueryType::ReplaceOne => {
            let filter = match &request.filter {
                Some(f) => json_to_bson_doc(f)?,
                None => doc! {},
            };
            let replacement = match &request.pipeline {
                Some(p) => {
                    p.iter()
                        .find_map(|stage| stage.get("$set"))
                        .map(|v| json_to_bson_doc(v))
                        .transpose()?
                        .unwrap_or(doc! {})
                }
                None => doc! {},
            };

            let result = collection
                .replace_one(filter, replacement)
                .await
                .map_err(|e| format!("ReplaceOne failed: {}", e))?;

            let upserted_count = if result.upserted_id.is_some() { 1 } else { 0 };
            let upserted_id_json = result.upserted_id.as_ref().map(|id| bson_to_json_value(id));

            Ok(QueryResult {
                documents: vec![serde_json::json!({
                    "acknowledged": true,
                    "matchedCount": result.matched_count,
                    "modifiedCount": result.modified_count,
                    "upsertedId": upserted_id_json,
                    "upsertedCount": upserted_count,
                    "insertedId": null,
                    "insertedCount": 0,
                    "deletedCount": 0
                })],
                has_more: false,
                query_type: QueryType::ReplaceOne,
                page: 1,
                page_size: 1,
            })
        }
        QueryType::Distinct => {
            let filter = match &request.filter {
                Some(f) => json_to_bson_doc(f)?,
                None => doc! {},
            };

            let docs = collection
                .distinct("null", filter)
                .await
                .map_err(|e| format!("Distinct failed: {}", e))?;

            let values: Vec<serde_json::Value> = docs
                .iter()
                .map(|v| bson_to_json_value(v))
                .collect();

            let count = values.len() as u64;
            Ok(QueryResult {
                documents: values,
                has_more: false,
                query_type: QueryType::Distinct,
                page: 1,
                page_size: count,
            })
        }
        QueryType::FindOne => {
            let filter = match &request.filter {
                Some(f) => json_to_bson_doc(f)?,
                None => doc! {},
            };

            let doc = collection
                .find_one(filter)
                .await
                .map_err(|e| format!("FindOne failed: {}", e))?;

            let documents = match doc {
                Some(d) => {
                    vec![bson_doc_to_json(&d)]
                }
                None => vec![],
            };

            Ok(QueryResult {
                documents,
                has_more: false,
                query_type: QueryType::FindOne,
                page: 1,
                page_size: 1,
            })
        }
        QueryType::FindOneAndUpdate => {
            let filter = match &request.filter {
                Some(f) => json_to_bson_doc(f)?,
                None => doc! {},
            };
            let update = match &request.projection {
                Some(u) => json_to_bson_doc(u)?,
                None => doc! {},
            };

            let doc = collection
                .find_one_and_update(filter, update)
                .await
                .map_err(|e| format!("FindOneAndUpdate failed: {}", e))?;

            let documents = match doc {
                Some(d) => {
                    vec![bson_doc_to_json(&d)]
                }
                None => vec![],
            };

            Ok(QueryResult {
                documents,
                has_more: false,
                query_type: QueryType::FindOneAndUpdate,
                page: 1,
                page_size: 1,
            })
        }
        QueryType::FindOneAndDelete => {
            let filter = match &request.filter {
                Some(f) => json_to_bson_doc(f)?,
                None => doc! {},
            };

            let doc = collection
                .find_one_and_delete(filter)
                .await
                .map_err(|e| format!("FindOneAndDelete failed: {}", e))?;

            let documents = match doc {
                Some(d) => {
                    vec![bson_doc_to_json(&d)]
                }
                None => vec![],
            };

            Ok(QueryResult {
                documents,
                has_more: false,
                query_type: QueryType::FindOneAndDelete,
                page: 1,
                page_size: 1,
            })
        }
        QueryType::FindOneAndReplace => {
            let filter = match &request.filter {
                Some(f) => json_to_bson_doc(f)?,
                None => doc! {},
            };
            let replacement = match &request.projection {
                Some(r) => json_to_bson_doc(r)?,
                None => doc! {},
            };

            let doc = collection
                .find_one_and_replace(filter, replacement)
                .await
                .map_err(|e| format!("FindOneAndReplace failed: {}", e))?;

            let documents = match doc {
                Some(d) => {
                    vec![bson_doc_to_json(&d)]
                }
                None => vec![],
            };

            Ok(QueryResult {
                documents,
                has_more: false,
                query_type: QueryType::FindOneAndReplace,
                page: 1,
                page_size: 1,
            })
        }
        QueryType::Other => {
            Err("Unsupported query type".to_string())
        }
    }
}

#[tauri::command]
pub async fn execute_raw_query(
    db: String,
    query_text: String,
    page: Option<u64>,
    page_size: Option<u64>,
    state: State<'_, MongoState>,
) -> Result<QueryResult, String> {
    let query_text = query_text.trim();
    let mut parsed = parse_query_string(query_text)?;
    parsed.args = preprocess_mongo_helpers(&parsed.args);

    let request = match parsed.query_type {
        QueryType::Find => {
            let args_parts = split_top_level_args(&parsed.args);
            let filter_str = args_parts.first().map(|s| s.as_str()).unwrap_or("");
            let inline_projection_str = args_parts.get(1).map(|s| s.as_str());

            let filter: Option<serde_json::Value> =
                if filter_str.is_empty() || filter_str == "{}" {
                    None
                } else {
                    Some(json5::from_str(filter_str).map_err(|e| {
                        format!("Invalid filter: {}. Input: {}", e, filter_str)
                    })?)
                };
            let sort: Option<serde_json::Value> = parsed
                .sort
                .as_ref()
                .filter(|s| !s.is_empty())
                .map(|s| json5::from_str(s))
                .transpose()
                .map_err(|e| format!("Invalid sort: {}", e))?;
            // Inline projection from find({}, {proj}) takes priority over .projection() chain
            let projection: Option<serde_json::Value> = if let Some(proj_str) = inline_projection_str {
                if !proj_str.is_empty() {
                    Some(json5::from_str(proj_str).map_err(|e| {
                        format!("Invalid projection: {}. Input: {}", e, proj_str)
                    })?)
                } else {
                    None
                }
            } else {
                parsed
                    .projection
                    .as_ref()
                    .filter(|s| !s.is_empty())
                    .map(|s| json5::from_str(s))
                    .transpose()
                    .map_err(|e| format!("Invalid projection: {}", e))?
            };

            QueryRequest {
                db,
                collection: parsed.collection,
                query_type: QueryType::Find,
                filter,
                pipeline: None,
                page,
                page_size: parsed.limit.map(|l| l as u64).or(page_size),
                sort,
                projection,
            }
        }
        QueryType::Aggregate => {
            let pipeline: Option<Vec<serde_json::Value>> =
                if parsed.args.is_empty() || parsed.args == "[]" {
                    None
                } else {
                    Some(json5::from_str(&parsed.args).map_err(|e| {
                        format!("Invalid pipeline: {}. Input: {}", e, parsed.args)
                    })?)
                };
            QueryRequest {
                db,
                collection: parsed.collection,
                query_type: QueryType::Aggregate,
                filter: None,
                pipeline,
                page,
                page_size,
                sort: None,
                projection: None,
            }
        }
        QueryType::Count => {
            let filter: Option<serde_json::Value> =
                if parsed.args.is_empty() || parsed.args == "{}" {
                    None
                } else {
                    Some(json5::from_str(&parsed.args).map_err(|e| {
                        format!("Invalid filter: {}. Input: {}", e, parsed.args)
                    })?)
                };
            QueryRequest {
                db,
                collection: parsed.collection,
                query_type: QueryType::Count,
                filter,
                pipeline: None,
                page: None,
                page_size: None,
                sort: None,
                projection: None,
            }
        }
        QueryType::DeleteOne | QueryType::DeleteMany => {
            let filter: Option<serde_json::Value> =
                if parsed.args.is_empty() || parsed.args == "{}" {
                    None
                } else {
                    Some(json5::from_str(&parsed.args).map_err(|e| {
                        format!("Invalid filter: {}. Input: {}", e, parsed.args)
                    })?)
                };
            QueryRequest {
                db,
                collection: parsed.collection,
                query_type: parsed.query_type,
                filter,
                pipeline: None,
                page: None,
                page_size: None,
                sort: None,
                projection: None,
            }
        }
        QueryType::InsertOne | QueryType::InsertMany => {
            let doc: Option<serde_json::Value> =
                if parsed.args.is_empty() {
                    None
                } else {
                    Some(json5::from_str(&parsed.args).map_err(|e| {
                        format!("Invalid document: {}. Input: {}", e, parsed.args)
                    })?)
                };
            QueryRequest {
                db,
                collection: parsed.collection,
                query_type: parsed.query_type,
                filter: None,
                pipeline: None,
                page: None,
                page_size: None,
                sort: None,
                projection: doc,
            }
        }
        QueryType::UpdateOne | QueryType::UpdateMany | QueryType::ReplaceOne => {
            // Args format: {filter}, {update}
            let parts = split_top_level_args(&parsed.args);
            let filter: Option<serde_json::Value> = if parts.is_empty() || parts[0].trim().is_empty() || parts[0].trim() == "{}" {
                None
            } else {
                Some(json5::from_str(&parts[0]).map_err(|e| {
                    format!("Invalid filter: {}. Input: {}", e, parts[0])
                })?)
            };
            let update: Option<serde_json::Value> = if parts.len() > 1 && !parts[1].trim().is_empty() {
                Some(json5::from_str(&parts[1]).map_err(|e| {
                    format!("Invalid update: {}. Input: {}", e, parts[1])
                })?)
            } else {
                None
            };
            // Combine filter and update into a single document for pipeline
            let pipeline: Option<Vec<serde_json::Value>> = Some(vec![
                serde_json::json!({ "$match": filter }),
                serde_json::json!({ "$set": update }),
            ]);
            QueryRequest {
                db,
                collection: parsed.collection,
                query_type: parsed.query_type,
                filter: None,
                pipeline,
                page: None,
                page_size: None,
                sort: None,
                projection: None,
            }
        }
        QueryType::Distinct => {
            let filter: Option<serde_json::Value> =
                if parsed.args.is_empty() || parsed.args == "{}" {
                    None
                } else {
                    Some(json5::from_str(&parsed.args).map_err(|e| {
                        format!("Invalid filter: {}. Input: {}", e, parsed.args)
                    })?)
                };
            QueryRequest {
                db,
                collection: parsed.collection,
                query_type: QueryType::Distinct,
                filter,
                pipeline: None,
                page: None,
                page_size: None,
                sort: None,
                projection: None,
            }
        }
        QueryType::FindOne => {
            let filter: Option<serde_json::Value> =
                if parsed.args.is_empty() || parsed.args == "{}" {
                    None
                } else {
                    Some(json5::from_str(&parsed.args).map_err(|e| {
                        format!("Invalid filter: {}. Input: {}", e, parsed.args)
                    })?)
                };
            QueryRequest {
                db,
                collection: parsed.collection,
                query_type: QueryType::FindOne,
                filter,
                pipeline: None,
                page: None,
                page_size: None,
                sort: None,
                projection: None,
            }
        }
        QueryType::FindOneAndUpdate | QueryType::FindOneAndDelete | QueryType::FindOneAndReplace => {
            let parts = split_top_level_args(&parsed.args);
            let filter: Option<serde_json::Value> = if parts.is_empty() || parts[0].trim().is_empty() || parts[0].trim() == "{}" {
                None
            } else {
                Some(json5::from_str(&parts[0]).map_err(|e| {
                    format!("Invalid filter: {}. Input: {}", e, parts[0])
                })?)
            };
            let update: Option<serde_json::Value> = if parts.len() > 1 && !parts[1].trim().is_empty() {
                Some(json5::from_str(&parts[1]).map_err(|e| {
                    format!("Invalid update: {}. Input: {}", e, parts[1])
                })?)
            } else {
                None
            };
            QueryRequest {
                db,
                collection: parsed.collection,
                query_type: parsed.query_type,
                filter,
                pipeline: None,
                page: None,
                page_size: None,
                sort: None,
                projection: update,
            }
        }
        QueryType::Other => {
            return Err(format!(
                "Unsupported method: {}. Supported methods: find, findOne, aggregate, count, distinct, insertOne, insertMany, updateOne, updateMany, replaceOne, deleteOne, deleteMany, findOneAndUpdate, findOneAndDelete, findOneAndReplace",
                query_text
            ));
        }
    };

    execute_query(request, state).await
}

/// Update a single document by replacing it
#[tauri::command]
pub async fn update_document(
    db: String,
    collection: String,
    document_json: String,
    state: State<'_, MongoState>,
) -> Result<(), String> {
    let client = state.get_client().await?;
    let coll = client.database(&db).collection::<Document>(&collection);

    let json_val: serde_json::Value =
        serde_json::from_str(&document_json).map_err(|e| format!("Invalid JSON: {}", e))?;

    let doc = json_to_bson_doc(&json_val)?;

    let id = doc
        .get("_id")
        .ok_or("Document must have an _id field")?
        .clone();

    let filter = doc! { "_id": id };

    let mut replacement = doc.clone();
    replacement.remove("_id");

    coll.replace_one(filter, replacement)
        .await
        .map_err(|e| format!("Update failed: {}", e))?;

    Ok(())
}

struct ParsedQuery {
    collection: String,
    query_type: QueryType,
    args: String,
    sort: Option<String>,
    projection: Option<String>,
    limit: Option<i64>,
}

fn find_matching_close(input: &str, start: usize) -> Option<usize> {
    let chars: Vec<char> = input.chars().collect();
    let open = chars[start];
    let close = match open {
        '(' => ')',
        '[' => ']',
        '{' => '}',
        _ => return None,
    };

    let mut depth = 0;
    let mut in_string = false;
    let mut string_char = '"';
    let mut i = start;

    while i < chars.len() {
        let ch = chars[i];

        if in_string {
            if ch == '\\' {
                i += 1;
            } else if ch == string_char {
                in_string = false;
            }
        } else {
            match ch {
                '"' | '\'' => {
                    in_string = true;
                    string_char = ch;
                }
                c if c == open => depth += 1,
                c if c == close => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(i);
                    }
                }
                _ => {}
            }
        }
        i += 1;
    }
    None
}

/// Split arguments at top-level commas, respecting nested braces/brackets/strings.
/// e.g. "{a: 1}, {$set: {b: 2}}" → ["{a: 1}", "{$set: {b: 2}}"]
fn split_top_level_args(input: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut depth = 0;
    let mut in_string = false;
    let mut string_char = '"';
    let mut current = String::new();

    for (i, ch) in input.chars().enumerate() {
        if in_string {
            current.push(ch);
            if ch == '\\' {
                // peek next char
                if let Some(next) = input.chars().nth(i + 1) {
                    let _ = next;
                }
            } else if ch == string_char {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' | '\'' => {
                in_string = true;
                string_char = ch;
                current.push(ch);
            }
            '{' | '[' | '(' => {
                depth += 1;
                current.push(ch);
            }
            '}' | ']' | ')' => {
                depth -= 1;
                current.push(ch);
            }
            ',' if depth == 0 => {
                parts.push(current.trim().to_string());
                current = String::new();
            }
            _ => {
                current.push(ch);
            }
        }
    }
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        parts.push(trimmed);
    }
    parts
}

fn parse_query_string(query: &str) -> Result<ParsedQuery, String> {
    let query = query.trim().trim_end_matches(';').trim();

    let after_db = query
        .strip_prefix("db.")
        .ok_or("Query must start with 'db.'")?;

    // Find the first method call (e.g., .find(), .count(), .deleteMany(), etc.)
    let dot_pos = after_db.find('.').ok_or("Query must contain a method call (e.g., .find())")?;

    let collection = after_db[..dot_pos].to_string();
    let method_part = &after_db[dot_pos + 1..];

    // Find method name and its arguments
    let paren_open = method_part.find('(').ok_or("Method must have parentheses")?;
    let method_name = method_part[..paren_open].to_string();
    let method_open = paren_open;

    let close_pos =
        find_matching_close(method_part, method_open).ok_or("Unmatched parenthesis in query")?;

    let args = method_part[method_open + 1..close_pos].trim().to_string();

    // Map method name to QueryType
    let query_type = match method_name.as_str() {
        "find" => QueryType::Find,
        "aggregate" => QueryType::Aggregate,
        "count" => QueryType::Count,
        "deleteOne" => QueryType::DeleteOne,
        "deleteMany" => QueryType::DeleteMany,
        "insertOne" => QueryType::InsertOne,
        "insertMany" => QueryType::InsertMany,
        "updateOne" => QueryType::UpdateOne,
        "updateMany" => QueryType::UpdateMany,
        "replaceOne" => QueryType::ReplaceOne,
        "distinct" => QueryType::Distinct,
        "findOne" => QueryType::FindOne,
        "findOneAndUpdate" => QueryType::FindOneAndUpdate,
        "findOneAndDelete" => QueryType::FindOneAndDelete,
        "findOneAndReplace" => QueryType::FindOneAndReplace,
        _ => QueryType::Other,
    };

    let mut sort = None;
    let mut projection = None;
    let mut limit = None;

    if matches!(query_type, QueryType::Find) {
        let remainder = &after_db[close_pos + 1..];
        let mut rest = remainder;

        while let Some(dot_pos) = rest.find('.') {
            rest = &rest[dot_pos + 1..];
            if rest.starts_with("sort(") {
                let paren_start = rest.find('(').unwrap();
                if let Some(close) = find_matching_close(rest, paren_start) {
                    sort = Some(rest[paren_start + 1..close].trim().to_string());
                    rest = &rest[close + 1..];
                } else {
                    break;
                }
            } else if rest.starts_with("limit(") {
                if let Some(close) = rest.find(')') {
                    let val = rest[6..close].trim();
                    limit = val.parse::<i64>().ok();
                    rest = &rest[close + 1..];
                } else {
                    break;
                }
            } else if rest.starts_with("skip(") {
                if let Some(close) = rest.find(')') {
                    rest = &rest[close + 1..];
                } else {
                    break;
                }
            } else if rest.starts_with("projection(") {
                let paren_start = rest.find('(').unwrap();
                if let Some(close) = find_matching_close(rest, paren_start) {
                    projection = Some(rest[paren_start + 1..close].trim().to_string());
                    rest = &rest[close + 1..];
                } else {
                    break;
                }
            } else {
                break;
            }
        }
    }

    Ok(ParsedQuery {
        collection,
        query_type,
        args,
        sort,
        projection,
        limit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── preprocess_mongo_helpers ───

    #[test]
    fn preprocess_objectid_single_quotes() {
        let input = r#"{_id: ObjectId('507f1f77bcf86cd799439011')}"#;
        let result = preprocess_mongo_helpers(input);
        assert!(result.contains(r#"{"$oid":"507f1f77bcf86cd799439011"}"#));
        assert!(!result.contains("ObjectId"));
    }

    #[test]
    fn preprocess_objectid_double_quotes() {
        let input = r#"{_id: ObjectId("507f1f77bcf86cd799439011")}"#;
        let result = preprocess_mongo_helpers(input);
        assert!(result.contains(r#"{"$oid":"507f1f77bcf86cd799439011"}"#));
    }

    #[test]
    fn preprocess_isodate() {
        let input = r#"{due: ISODate('2026-08-31T07:00:00.000Z')}"#;
        let result = preprocess_mongo_helpers(input);
        assert!(result.contains(r#"{"$date":"2026-08-31T07:00:00.000Z"}"#));
        assert!(!result.contains("ISODate"));
    }

    #[test]
    fn preprocess_new_date() {
        let input = r#"{created: new Date('2024-01-15T10:30:00.000Z')}"#;
        let result = preprocess_mongo_helpers(input);
        assert!(result.contains(r#"{"$date":"2024-01-15T10:30:00.000Z"}"#));
        assert!(!result.contains("new Date"));
    }

    #[test]
    fn preprocess_multiple_helpers() {
        let input = r#"{_id: ObjectId('507f1f77bcf86cd799439011'), due: ISODate('2026-08-31T07:00:00.000Z')}"#;
        let result = preprocess_mongo_helpers(input);
        assert!(result.contains(r#"{"$oid":"507f1f77bcf86cd799439011"}"#));
        assert!(result.contains(r#"{"$date":"2026-08-31T07:00:00.000Z"}"#));
    }

    #[test]
    fn preprocess_no_helpers_unchanged() {
        let input = r#"{name: "test", age: 25}"#;
        let result = preprocess_mongo_helpers(input);
        assert_eq!(result, input);
    }

    // ─── json_value_to_bson: ObjectId ───

    #[test]
    fn json_to_bson_objectid() {
        let json: serde_json::Value = serde_json::json!({"$oid": "507f1f77bcf86cd799439011"});
        let bson = json_value_to_bson(&json);
        assert!(matches!(bson, bson::Bson::ObjectId(_)));
        if let bson::Bson::ObjectId(oid) = bson {
            assert_eq!(oid.to_hex(), "507f1f77bcf86cd799439011");
        }
    }

    // ─── json_value_to_bson: Date ───

    #[test]
    fn json_to_bson_date_iso_string() {
        let json: serde_json::Value = serde_json::json!({"$date": "2026-08-31T07:00:00.000Z"});
        let bson = json_value_to_bson(&json);
        assert!(matches!(bson, bson::Bson::DateTime(_)));
    }

    #[test]
    fn json_to_bson_date_millis() {
        let json: serde_json::Value = serde_json::json!({"$date": 1724054400000_i64});
        let bson = json_value_to_bson(&json);
        assert!(matches!(bson, bson::Bson::DateTime(_)));
    }

    // ─── json_value_to_bson: NumberDecimal ───

    #[test]
    fn json_to_bson_number_decimal() {
        let json: serde_json::Value = serde_json::json!({"$numberDecimal": "123.456"});
        let bson = json_value_to_bson(&json);
        assert!(matches!(bson, bson::Bson::Decimal128(_)));
    }

    // ─── bson_to_json_value round-trip ───

    #[test]
    fn roundtrip_objectid() {
        let oid = ObjectId::parse_str("507f1f77bcf86cd799439011").unwrap();
        let bson_val = bson::Bson::ObjectId(oid);

        // bson → json
        let json = bson_to_json_value(&bson_val);
        assert_eq!(json, serde_json::json!({"$oid": "507f1f77bcf86cd799439011"}));

        // json → bson (round-trip)
        let back = json_value_to_bson(&json);
        assert!(matches!(back, bson::Bson::ObjectId(_)));
        if let bson::Bson::ObjectId(o) = back {
            assert_eq!(o.to_hex(), "507f1f77bcf86cd799439011");
        }
    }

    #[test]
    fn roundtrip_date() {
        let dt = bson::DateTime::parse_rfc3339_str("2026-08-31T07:00:00.000Z").unwrap();
        let bson_val = bson::Bson::DateTime(dt);

        // bson → json
        let json = bson_to_json_value(&bson_val);
        let date_str = json.get("$date").and_then(|v| v.as_str()).unwrap();
        assert!(date_str.starts_with("2026-08-31"));

        // json → bson (round-trip)
        let back = json_value_to_bson(&json);
        assert!(matches!(back, bson::Bson::DateTime(_)));
        if let bson::Bson::DateTime(d) = back {
            assert_eq!(d.timestamp_millis(), dt.timestamp_millis());
        }
    }

    #[test]
    fn roundtrip_decimal128() {
        let dec: bson::Decimal128 = "123.456".parse().unwrap();
        let bson_val = bson::Bson::Decimal128(dec);

        // bson → json
        let json = bson_to_json_value(&bson_val);
        assert_eq!(json, serde_json::json!({"$numberDecimal": "123.456"}));

        // json → bson (round-trip)
        let back = json_value_to_bson(&json);
        assert!(matches!(back, bson::Bson::Decimal128(_)));
        if let bson::Bson::Decimal128(d) = back {
            assert_eq!(d.to_string(), "123.456");
        }
    }

    // ─── Full pipeline: preprocess → json5 → bson (simulates save from editor) ───

    #[test]
    fn save_pipeline_objectid() {
        // User types ObjectId('...') in editor, preprocessed, parsed, converted to BSON
        let input = r#"{"_id": ObjectId('507f1f77bcf86cd799439011'), "name": "test"}"#;
        let preprocessed = preprocess_mongo_helpers(input);
        let json: serde_json::Value = json5::from_str(&preprocessed).unwrap();
        let doc = json_to_bson_doc(&json).unwrap();

        assert!(matches!(doc.get("_id"), Some(bson::Bson::ObjectId(_))));
        assert!(matches!(doc.get("name"), Some(bson::Bson::String(_))));
    }

    #[test]
    fn save_pipeline_isodate() {
        let input = r#"{"due": ISODate('2026-08-31T07:00:00.000Z')}"#;
        let preprocessed = preprocess_mongo_helpers(input);
        let json: serde_json::Value = json5::from_str(&preprocessed).unwrap();
        let doc = json_to_bson_doc(&json).unwrap();

        assert!(matches!(doc.get("due"), Some(bson::Bson::DateTime(_))));
    }

    #[test]
    fn save_pipeline_new_date() {
        let input = r#"{"created": new Date('2024-01-15T10:30:00.000Z')}"#;
        let preprocessed = preprocess_mongo_helpers(input);
        let json: serde_json::Value = json5::from_str(&preprocessed).unwrap();
        let doc = json_to_bson_doc(&json).unwrap();

        assert!(matches!(doc.get("created"), Some(bson::Bson::DateTime(_))));
    }

    #[test]
    fn save_pipeline_number_decimal() {
        // In JSON detail view, NumberDecimal is shown as {"$numberDecimal": "..."}
        let input = r#"{"price": {"$numberDecimal": "99.99"}}"#;
        let json: serde_json::Value = json5::from_str(input).unwrap();
        let doc = json_to_bson_doc(&json).unwrap();

        assert!(matches!(doc.get("price"), Some(bson::Bson::Decimal128(_))));
        if let Some(bson::Bson::Decimal128(d)) = doc.get("price") {
            assert_eq!(d.to_string(), "99.99");
        }
    }

    // ─── JSON view save round-trip: bson → json → edit → json → bson ───

    #[test]
    fn jsonview_save_roundtrip_objectid() {
        let oid = ObjectId::parse_str("507f1f77bcf86cd799439011").unwrap();
        let doc = doc! { "_id": oid, "name": "test" };

        // DB → JSON (what user sees in detail view)
        let json = bson_doc_to_json(&doc);
        let json_str = serde_json::to_string(&json).unwrap();

        // User saves JSON (detail view :w) → parse back → BSON
        let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        let saved_doc = json_to_bson_doc(&parsed).unwrap();

        assert!(matches!(saved_doc.get("_id"), Some(bson::Bson::ObjectId(_))));
        if let Some(bson::Bson::ObjectId(o)) = saved_doc.get("_id") {
            assert_eq!(o.to_hex(), "507f1f77bcf86cd799439011");
        }
    }

    #[test]
    fn jsonview_save_roundtrip_date() {
        let dt = bson::DateTime::parse_rfc3339_str("2026-08-31T07:00:00.000Z").unwrap();
        let doc = doc! { "due": dt };

        let json = bson_doc_to_json(&doc);
        let json_str = serde_json::to_string(&json).unwrap();

        let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        let saved_doc = json_to_bson_doc(&parsed).unwrap();

        assert!(matches!(saved_doc.get("due"), Some(bson::Bson::DateTime(_))));
        if let Some(bson::Bson::DateTime(d)) = saved_doc.get("due") {
            assert_eq!(d.timestamp_millis(), dt.timestamp_millis());
        }
    }

    #[test]
    fn jsonview_save_roundtrip_decimal128() {
        let dec: bson::Decimal128 = "199.99".parse().unwrap();
        let doc = doc! { "price": dec };

        let json = bson_doc_to_json(&doc);
        let json_str = serde_json::to_string(&json).unwrap();

        let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        let saved_doc = json_to_bson_doc(&parsed).unwrap();

        assert!(matches!(saved_doc.get("price"), Some(bson::Bson::Decimal128(_))));
        if let Some(bson::Bson::Decimal128(d)) = saved_doc.get("price") {
            assert_eq!(d.to_string(), "199.99");
        }
    }

    // ─── preprocess: Long / NumberLong / NumberDecimal ───

    #[test]
    fn preprocess_number_long() {
        let input = r#"{count: NumberLong('2333')}"#;
        let result = preprocess_mongo_helpers(input);
        assert!(result.contains(r#"{"$numberLong":"2333"}"#));
        assert!(!result.contains("NumberLong"));
    }

    #[test]
    fn preprocess_long() {
        let input = r#"{count: Long('2333')}"#;
        let result = preprocess_mongo_helpers(input);
        assert!(result.contains(r#"{"$numberLong":"2333"}"#));
        assert!(!result.contains("Long("));
    }

    #[test]
    fn preprocess_number_decimal() {
        let input = r#"{price: NumberDecimal('99.99')}"#;
        let result = preprocess_mongo_helpers(input);
        assert!(result.contains(r#"{"$numberDecimal":"99.99"}"#));
        assert!(!result.contains("NumberDecimal"));
    }

    // ─── json_value_to_bson: numbers ───

    #[test]
    fn json_to_bson_number_long() {
        let json: serde_json::Value = serde_json::json!({"$numberLong": "2333"});
        let bson = json_value_to_bson(&json);
        assert!(matches!(bson, bson::Bson::Int64(2333)));
    }

    #[test]
    fn json_to_bson_number_double() {
        let json: serde_json::Value = serde_json::json!({"$numberDouble": "3.14"});
        let bson = json_value_to_bson(&json);
        if let bson::Bson::Double(f) = bson {
            assert!((f - 3.14).abs() < f64::EPSILON);
        } else {
            panic!("Expected Double, got {:?}", bson);
        }
    }

    #[test]
    fn json_to_bson_plain_int_becomes_int32() {
        let json: serde_json::Value = serde_json::json!(2333);
        let bson = json_value_to_bson(&json);
        assert!(matches!(bson, bson::Bson::Int32(2333)));
    }

    #[test]
    fn json_to_bson_plain_float_becomes_double() {
        let json: serde_json::Value = serde_json::json!(23.33);
        let bson = json_value_to_bson(&json);
        if let bson::Bson::Double(f) = bson {
            assert!((f - 23.33).abs() < f64::EPSILON);
        } else {
            panic!("Expected Double, got {:?}", bson);
        }
    }

    #[test]
    fn json_to_bson_large_int_becomes_int64() {
        let json: serde_json::Value = serde_json::json!(3_000_000_000_i64);
        let bson = json_value_to_bson(&json);
        assert!(matches!(bson, bson::Bson::Int64(3_000_000_000)));
    }

    // ─── round-trip: Int64 / Double ───

    #[test]
    fn roundtrip_int64() {
        let bson_val = bson::Bson::Int64(2333);

        let json = bson_to_json_value(&bson_val);
        assert_eq!(json, serde_json::json!({"$numberLong": "2333"}));

        let back = json_value_to_bson(&json);
        assert!(matches!(back, bson::Bson::Int64(2333)));
    }

    #[test]
    fn roundtrip_int32() {
        let bson_val = bson::Bson::Int32(42);

        let json = bson_to_json_value(&bson_val);
        assert_eq!(json, serde_json::json!(42));

        let back = json_value_to_bson(&json);
        assert!(matches!(back, bson::Bson::Int32(42)));
    }

    #[test]
    fn roundtrip_double() {
        let bson_val = bson::Bson::Double(3.14);

        let json = bson_to_json_value(&bson_val);
        let back = json_value_to_bson(&json);
        if let bson::Bson::Double(f) = back {
            assert!((f - 3.14).abs() < f64::EPSILON);
        } else {
            panic!("Expected Double, got {:?}", back);
        }
    }

    // ─── save pipeline: Long / NumberDecimal ───

    #[test]
    fn save_pipeline_number_long() {
        let input = r#"{"count": NumberLong('2333')}"#;
        let preprocessed = preprocess_mongo_helpers(input);
        let json: serde_json::Value = json5::from_str(&preprocessed).unwrap();
        let doc = json_to_bson_doc(&json).unwrap();
        assert!(matches!(doc.get("count"), Some(bson::Bson::Int64(2333))));
    }

    #[test]
    fn save_pipeline_long() {
        let input = r#"{"count": Long('9999')}"#;
        let preprocessed = preprocess_mongo_helpers(input);
        let json: serde_json::Value = json5::from_str(&preprocessed).unwrap();
        let doc = json_to_bson_doc(&json).unwrap();
        assert!(matches!(doc.get("count"), Some(bson::Bson::Int64(9999))));
    }

    // ─── JSON view save round-trip: Int64 ───

    #[test]
    fn jsonview_save_roundtrip_int64() {
        let doc = doc! { "count": 2333_i64 };

        let json = bson_doc_to_json(&doc);
        let json_str = serde_json::to_string(&json).unwrap();

        let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        let saved_doc = json_to_bson_doc(&parsed).unwrap();

        assert!(matches!(saved_doc.get("count"), Some(bson::Bson::Int64(2333))));
    }

    // ─── split_top_level_args ───

    #[test]
    fn split_args_simple() {
        let parts = split_top_level_args(r#"{a: 1}, {$set: {b: 2}}"#);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], "{a: 1}");
        assert_eq!(parts[1], "{$set: {b: 2}}");
    }

    #[test]
    fn split_args_nested_objectid() {
        let input = r#"{"_id": {"$oid":"507f1f77bcf86cd799439011"}}, {"$set": {"a": 1}}"#;
        let parts = split_top_level_args(input);
        assert_eq!(parts.len(), 2);
        assert!(parts[0].contains("$oid"));
        assert!(parts[1].contains("$set"));
    }

    #[test]
    fn split_args_single() {
        let parts = split_top_level_args(r#"{name: "test"}"#);
        assert_eq!(parts.len(), 1);
    }

    // ─── parse_query_string ───

    // ─── parse_query_string: all methods ───

    #[test]
    fn parse_find() {
        let parsed = parse_query_string(r#"db.users.find({age: 25})"#).unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::Find));
        assert!(parsed.args.contains("age"));
    }

    #[test]
    fn parse_find_empty() {
        let parsed = parse_query_string("db.users.find({})").unwrap();
        assert!(matches!(parsed.query_type, QueryType::Find));
        assert_eq!(parsed.args, "{}");
    }

    #[test]
    fn parse_find_no_args() {
        let parsed = parse_query_string("db.users.find()").unwrap();
        assert!(matches!(parsed.query_type, QueryType::Find));
        assert!(parsed.args.is_empty());
    }

    #[test]
    fn parse_find_with_projection() {
        let parsed = parse_query_string(r#"db.users.find({}, {name: 1})"#).unwrap();
        assert!(matches!(parsed.query_type, QueryType::Find));
    }

    #[test]
    fn parse_find_with_sort() {
        let parsed = parse_query_string(r#"db.users.find({}).sort({age: -1})"#).unwrap();
        assert!(matches!(parsed.query_type, QueryType::Find));
        assert_eq!(parsed.sort.as_deref(), Some("{age: -1}"));
    }

    #[test]
    fn parse_find_with_limit() {
        let parsed = parse_query_string("db.users.find({}).limit(10)").unwrap();
        assert!(matches!(parsed.query_type, QueryType::Find));
        assert_eq!(parsed.limit, Some(10));
    }

    #[test]
    fn parse_find_with_sort_and_limit() {
        let parsed = parse_query_string(r#"db.users.find({}).sort({age: 1}).limit(5)"#).unwrap();
        assert!(matches!(parsed.query_type, QueryType::Find));
        assert_eq!(parsed.sort.as_deref(), Some("{age: 1}"));
        assert_eq!(parsed.limit, Some(5));
    }

    #[test]
    fn parse_find_with_chained_projection() {
        let parsed = parse_query_string(r#"db.users.find({}).projection({name: 1})"#).unwrap();
        assert!(matches!(parsed.query_type, QueryType::Find));
        assert_eq!(parsed.projection.as_deref(), Some("{name: 1}"));
    }

    #[test]
    fn parse_find_with_objectid() {
        let query = r#"db.users.find({_id: {"$oid":"507f1f77bcf86cd799439011"}})"#;
        let parsed = parse_query_string(query).unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::Find));
        assert!(parsed.args.contains("$oid"));
    }

    #[test]
    fn parse_find_one() {
        let parsed = parse_query_string(r#"db.users.findOne({name: "alice"})"#).unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::FindOne));
    }

    #[test]
    fn parse_aggregate() {
        let parsed = parse_query_string(r#"db.orders.aggregate([{$match: {status: "A"}}, {$group: {_id: "$item"}}])"#).unwrap();
        assert_eq!(parsed.collection, "orders");
        assert!(matches!(parsed.query_type, QueryType::Aggregate));
        assert!(parsed.args.contains("$match"));
        assert!(parsed.args.contains("$group"));
    }

    #[test]
    fn parse_aggregate_empty() {
        let parsed = parse_query_string("db.orders.aggregate([])").unwrap();
        assert!(matches!(parsed.query_type, QueryType::Aggregate));
    }

    #[test]
    fn parse_count() {
        let parsed = parse_query_string(r#"db.users.count({active: true})"#).unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::Count));
    }

    #[test]
    fn parse_count_empty() {
        let parsed = parse_query_string("db.users.count({})").unwrap();
        assert!(matches!(parsed.query_type, QueryType::Count));
    }

    #[test]
    fn parse_distinct() {
        let parsed = parse_query_string(r#"db.users.distinct("city")"#).unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::Distinct));
    }

    #[test]
    fn parse_insert_one() {
        let parsed = parse_query_string(r#"db.users.insertOne({name: "bob", age: 30})"#).unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::InsertOne));
        assert!(parsed.args.contains("bob"));
    }

    #[test]
    fn parse_insert_many() {
        let parsed = parse_query_string(r#"db.users.insertMany([{name: "a"}, {name: "b"}])"#).unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::InsertMany));
        assert!(parsed.args.starts_with('['));
    }

    #[test]
    fn parse_update_one() {
        let parsed = parse_query_string(r#"db.users.updateOne({name: "a"}, {$set: {age: 1}})"#).unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::UpdateOne));
    }

    #[test]
    fn parse_update_many() {
        let parsed = parse_query_string(r#"db.users.updateMany({active: false}, {$set: {archived: true}})"#).unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::UpdateMany));
    }

    #[test]
    fn parse_replace_one() {
        let parsed = parse_query_string(r#"db.users.replaceOne({name: "a"}, {name: "b", age: 25})"#).unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::ReplaceOne));
    }

    #[test]
    fn parse_delete_one() {
        let parsed = parse_query_string(r#"db.users.deleteOne({name: "a"})"#).unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::DeleteOne));
    }

    #[test]
    fn parse_delete_many() {
        let parsed = parse_query_string(r#"db.users.deleteMany({active: false})"#).unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::DeleteMany));
    }

    #[test]
    fn parse_find_one_and_update() {
        let parsed = parse_query_string(r#"db.users.findOneAndUpdate({name: "a"}, {$set: {age: 99}})"#).unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::FindOneAndUpdate));
    }

    #[test]
    fn parse_find_one_and_delete() {
        let parsed = parse_query_string(r#"db.users.findOneAndDelete({name: "a"})"#).unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::FindOneAndDelete));
    }

    #[test]
    fn parse_find_one_and_replace() {
        let parsed = parse_query_string(r#"db.users.findOneAndReplace({name: "a"}, {name: "b"})"#).unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::FindOneAndReplace));
    }

    #[test]
    fn parse_unsupported_method() {
        let parsed = parse_query_string("db.users.drop()").unwrap();
        assert!(matches!(parsed.query_type, QueryType::Other));
    }

    // ─── parse edge cases ───

    #[test]
    fn parse_trailing_semicolon() {
        let parsed = parse_query_string("db.users.find({});").unwrap();
        assert!(matches!(parsed.query_type, QueryType::Find));
    }

    #[test]
    fn parse_whitespace() {
        let parsed = parse_query_string("  db.users.find({})  ").unwrap();
        assert!(matches!(parsed.query_type, QueryType::Find));
        assert_eq!(parsed.collection, "users");
    }

    #[test]
    fn parse_collection_name() {
        let parsed = parse_query_string("db.invoices.find({})").unwrap();
        assert_eq!(parsed.collection, "invoices");
        assert!(matches!(parsed.query_type, QueryType::Find));
    }

    #[test]
    fn parse_nested_objects_in_args() {
        let parsed = parse_query_string(r#"db.users.find({address: {city: "NYC", zip: {$gt: 10000}}})"#).unwrap();
        assert!(matches!(parsed.query_type, QueryType::Find));
        assert!(parsed.args.contains("address"));
    }

    #[test]
    fn parse_multiline_query() {
        let query = "db.invoices.updateOne({\n  _id: {\"$oid\":\"abc\"}\n}, {\n  $set: {\n    a: 1\n  }\n})";
        let parsed = parse_query_string(query).unwrap();
        assert!(matches!(parsed.query_type, QueryType::UpdateOne));
        assert_eq!(parsed.collection, "invoices");
    }

    #[test]
    fn parse_no_db_prefix_errors() {
        let result = parse_query_string("users.find({})");
        assert!(result.is_err());
    }

    #[test]
    fn parse_no_method_errors() {
        let result = parse_query_string("db.users");
        assert!(result.is_err());
    }

    #[test]
    fn parse_no_parens_errors() {
        let result = parse_query_string("db.users.find");
        assert!(result.is_err());
    }
}
