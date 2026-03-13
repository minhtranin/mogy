use crate::db::client::MongoState;
use mongodb::bson::{self, doc, oid::ObjectId, Document};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum QueryType {
    Find,
    Aggregate,
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
    pub total_count: u64,
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

            let total_count = collection
                .count_documents(filter.clone())
                .await
                .map_err(|e| format!("Count failed: {}", e))?;

            let mut find = collection.find(filter).skip(skip).limit(page_size as i64);

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
                let json_val: serde_json::Value =
                    serde_json::to_value(&doc).map_err(|e| format!("JSON error: {}", e))?;
                documents.push(json_val);
            }

            Ok(QueryResult {
                documents,
                total_count,
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

            let mut cursor = collection
                .aggregate(pipeline)
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
                let json_val: serde_json::Value =
                    serde_json::to_value(&doc).map_err(|e| format!("JSON error: {}", e))?;
                documents.push(json_val);
            }

            let count = documents.len() as u64;
            Ok(QueryResult {
                documents,
                total_count: count,
                query_type: QueryType::Aggregate,
                page: 1,
                page_size: count,
            })
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
    let parsed = parse_query_string(query_text)?;

    let request = match parsed.query_type {
        QueryType::Find => {
            let filter: Option<serde_json::Value> =
                if parsed.args.is_empty() || parsed.args == "{}" {
                    None
                } else {
                    Some(json5::from_str(&parsed.args).map_err(|e| {
                        format!("Invalid filter: {}. Input: {}", e, parsed.args)
                    })?)
                };
            let sort: Option<serde_json::Value> = parsed
                .sort
                .as_ref()
                .filter(|s| !s.is_empty())
                .map(|s| json5::from_str(s))
                .transpose()
                .map_err(|e| format!("Invalid sort: {}", e))?;
            let projection: Option<serde_json::Value> = parsed
                .projection
                .as_ref()
                .filter(|s| !s.is_empty())
                .map(|s| json5::from_str(s))
                .transpose()
                .map_err(|e| format!("Invalid projection: {}", e))?;

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
                page: None,
                page_size: None,
                sort: None,
                projection: None,
            }
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

fn parse_query_string(query: &str) -> Result<ParsedQuery, String> {
    let query = query.trim().trim_end_matches(';').trim();

    let after_db = query
        .strip_prefix("db.")
        .ok_or("Query must start with 'db.'")?;

    let (collection, method_start, query_type) = if let Some(pos) = after_db.find(".find(") {
        (after_db[..pos].to_string(), pos + 5, QueryType::Find)
    } else if let Some(pos) = after_db.find(".aggregate(") {
        (
            after_db[..pos].to_string(),
            pos + 10,
            QueryType::Aggregate,
        )
    } else {
        return Err("Query must contain .find() or .aggregate()".to_string());
    };

    let close_pos =
        find_matching_close(after_db, method_start).ok_or("Unmatched parenthesis in query")?;

    let args = after_db[method_start + 1..close_pos].trim().to_string();

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
