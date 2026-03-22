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
    CountDocuments,
    EstimatedDocumentCount,
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
                if let Some(ts_obj) = map.get("$timestamp").and_then(|v| v.as_object()) {
                    let t = ts_obj.get("t").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                    let inc = ts_obj.get("i").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                    return bson::Bson::Timestamp(bson::Timestamp { time: t, increment: inc });
                }
                if let Some(s) = map.get("$uuid").and_then(|v| v.as_str()) {
                    // Store UUID as string since bson crate doesn't have a native UUID type
                    let uuid_doc = doc! { "$uuid": s };
                    return bson::Bson::Document(uuid_doc);
                }
                if let Some(re_obj) = map.get("$regularExpression").and_then(|v| v.as_object()) {
                    let pattern = re_obj.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
                    let options = re_obj.get("options").and_then(|v| v.as_str()).unwrap_or("");
                    return bson::Bson::RegularExpression(bson::Regex {
                        pattern: pattern.to_string(),
                        options: options.to_string(),
                    });
                }
                if map.get("$minKey").is_some() {
                    return bson::Bson::MinKey;
                }
                if map.get("$maxKey").is_some() {
                    return bson::Bson::MaxKey;
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

/// Strip JS-style comments: // line comments and /* block comments */
fn strip_comments(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut i = 0;
    let mut in_single_quote = false;
    let mut in_double_quote = false;

    while i < len {
        // Inside a string: handle escapes and closing quote
        if in_single_quote || in_double_quote {
            if chars[i] == '\\' && i + 1 < len {
                result.push(chars[i]);
                result.push(chars[i + 1]);
                i += 2;
                continue;
            }
            if !in_double_quote && chars[i] == '\'' {
                in_single_quote = false;
            }
            if !in_single_quote && chars[i] == '"' {
                in_double_quote = false;
            }
            result.push(chars[i]);
            i += 1;
            continue;
        }
        // Track string context to avoid stripping inside strings
        if chars[i] == '\'' {
            in_single_quote = true;
            result.push(chars[i]);
            i += 1;
            continue;
        }
        if chars[i] == '"' {
            in_double_quote = true;
            result.push(chars[i]);
            i += 1;
            continue;
        }

        // Line comment: // ... \n
        if i + 1 < len && chars[i] == '/' && chars[i + 1] == '/' {
            // Skip to end of line
            while i < len && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        // Block comment: /* ... */
        if i + 1 < len && chars[i] == '/' && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < len && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            if i + 1 < len {
                i += 2; // skip */
            }
            continue;
        }
        result.push(chars[i]);
        i += 1;
    }
    result
}

/// Preprocess MongoDB shell helpers like ObjectId('...'), new Date('...'), ISODate('...')
/// into extended JSON that json5 can parse.
fn preprocess_mongo_helpers(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    // Build char-index → byte-offset map for safe string slicing with multi-byte chars
    let bo: Vec<usize> = input.char_indices().map(|(b, _)| b).chain(std::iter::once(input.len())).collect();
    let mut i = 0;

    // Safe substring comparison: chars[ci..ci+n] matches s
    let matches_at = |ci: usize, s: &str| -> bool {
        ci + s.len() <= len && &input[bo[ci]..bo[ci + s.len()]] == s
    };

    while i < len {
        // Skip "new " prefix — handle "new ObjectId(...)", "new Date(...)"
        let after_new = if matches_at(i, "new ") { i + 4 } else { i };

        // ObjectId('...')
        if matches_at(after_new, "ObjectId(") {
            let arg_start = after_new + 9;
            if let Some((value, end)) = extract_helper_arg(&chars, arg_start) {
                result.push_str(&format!(r#"{{"$oid":"{}"}}"#, value));
                i = end;
                continue;
            }
        }

        // Date('...') or Date() or Date(millis)
        if matches_at(after_new, "Date(") {
            let arg_start = after_new + 5;
            if let Some((value, end)) = extract_helper_arg(&chars, arg_start) {
                result.push_str(&format!(r#"{{"$date":"{}"}}"#, value));
                i = end;
                continue;
            }
            if let Some((value, end)) = extract_numeric_arg(&chars, arg_start) {
                result.push_str(&format!(r#"{{"$date":{{"$numberLong":"{}"}}}}"#, value));
                i = end;
                continue;
            }
            if let Some(end) = extract_empty_arg(&chars, arg_start) {
                let now = bson::DateTime::now();
                let iso = now.try_to_rfc3339_string().unwrap_or_default();
                result.push_str(&format!(r#"{{"$date":"{}"}}"#, iso));
                i = end;
                continue;
            }
        }

        // ISODate('...') or ISODate()
        if matches_at(after_new, "ISODate(") {
            let arg_start = after_new + 8;
            if let Some((value, end)) = extract_helper_arg(&chars, arg_start) {
                result.push_str(&format!(r#"{{"$date":"{}"}}"#, value));
                i = end;
                continue;
            }
            if let Some(end) = extract_empty_arg(&chars, arg_start) {
                let now = bson::DateTime::now();
                let iso = now.try_to_rfc3339_string().unwrap_or_default();
                result.push_str(&format!(r#"{{"$date":"{}"}}"#, iso));
                i = end;
                continue;
            }
        }

        // Timestamp(t, i)
        if matches_at(after_new, "Timestamp(") {
            let arg_start = after_new + 10;
            if let Some((t, inc, end)) = extract_two_numeric_args(&chars, arg_start) {
                result.push_str(&format!(r#"{{"$timestamp":{{"t":{},"i":{}}}}}"#, t, inc));
                i = end;
                continue;
            }
            if let Some(end) = extract_empty_arg(&chars, arg_start) {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                result.push_str(&format!(r#"{{"$timestamp":{{"t":{},"i":1}}}}"#, now));
                i = end;
                continue;
            }
        }

        // NumberLong('...') or NumberLong(123)
        if matches_at(after_new, "NumberLong(") {
            let arg_start = after_new + 11;
            if let Some((value, end)) = extract_helper_arg(&chars, arg_start) {
                result.push_str(&format!(r#"{{"$numberLong":"{}"}}"#, value));
                i = end;
                continue;
            }
            if let Some((value, end)) = extract_numeric_arg(&chars, arg_start) {
                result.push_str(&format!(r#"{{"$numberLong":"{}"}}"#, value));
                i = end;
                continue;
            }
        }

        // Long('...') or Long(123)
        if matches_at(after_new, "Long(") {
            // Avoid matching "NumberLong(" — check preceding char
            let prev_byte = if after_new > 0 { bo[after_new] - 1 } else { 0 };
            if after_new == 0 || !input.as_bytes()[prev_byte].is_ascii_alphanumeric() {
                let arg_start = after_new + 5;
                if let Some((value, end)) = extract_helper_arg(&chars, arg_start) {
                    result.push_str(&format!(r#"{{"$numberLong":"{}"}}"#, value));
                    i = end;
                    continue;
                }
                if let Some((value, end)) = extract_numeric_arg(&chars, arg_start) {
                    result.push_str(&format!(r#"{{"$numberLong":"{}"}}"#, value));
                    i = end;
                    continue;
                }
            }
        }

        // NumberInt(123) or NumberInt('...')
        if matches_at(after_new, "NumberInt(") {
            let arg_start = after_new + 10;
            if let Some((value, end)) = extract_helper_arg(&chars, arg_start) {
                result.push_str(&format!(r#"{{"$numberInt":"{}"}}"#, value));
                i = end;
                continue;
            }
            if let Some((value, end)) = extract_numeric_arg(&chars, arg_start) {
                result.push_str(&format!(r#"{{"$numberInt":"{}"}}"#, value));
                i = end;
                continue;
            }
        }

        // NumberDecimal('...') or NumberDecimal(123.45)
        if matches_at(after_new, "NumberDecimal(") {
            let arg_start = after_new + 14;
            if let Some((value, end)) = extract_helper_arg(&chars, arg_start) {
                result.push_str(&format!(r#"{{"$numberDecimal":"{}"}}"#, value));
                i = end;
                continue;
            }
            if let Some((value, end)) = extract_numeric_arg(&chars, arg_start) {
                result.push_str(&format!(r#"{{"$numberDecimal":"{}"}}"#, value));
                i = end;
                continue;
            }
        }

        // UUID('...')
        if matches_at(after_new, "UUID(") {
            let arg_start = after_new + 5;
            if let Some((value, end)) = extract_helper_arg(&chars, arg_start) {
                result.push_str(&format!(r#"{{"$uuid":"{}"}}"#, value));
                i = end;
                continue;
            }
        }

        // BinData(subtype, 'base64...')
        if matches_at(after_new, "BinData(") {
            let arg_start = after_new + 8;
            if let Some((subtype, data, end)) = extract_bindata_args(&chars, arg_start) {
                result.push_str(&format!(r#"{{"$binary":{{"base64":"{}","subType":"{}"}}}}"#, data, subtype));
                i = end;
                continue;
            }
        }

        // MinKey (no parens) or MinKey()
        if matches_at(after_new, "MinKey") {
            let after_kw = after_new + 6;
            let is_word_end = after_kw >= len || !chars[after_kw].is_ascii_alphanumeric();
            if is_word_end {
                result.push_str(r#"{"$minKey":1}"#);
                i = after_kw;
                // Skip optional ()
                if matches_at(i, "()") {
                    i += 2;
                }
                continue;
            }
        }

        // MaxKey (no parens) or MaxKey()
        if matches_at(after_new, "MaxKey") {
            let after_kw = after_new + 6;
            let is_word_end = after_kw >= len || !chars[after_kw].is_ascii_alphanumeric();
            if is_word_end {
                result.push_str(r#"{"$maxKey":1}"#);
                i = after_kw;
                if matches_at(i, "()") {
                    i += 2;
                }
                continue;
            }
        }

        // RegExp('pattern', 'flags') or RegExp('pattern')
        if matches_at(after_new, "RegExp(") {
            let arg_start = after_new + 7;
            if let Some((pattern, flags, end)) = extract_regexp_args(&chars, arg_start) {
                result.push_str(&format!(
                    r#"{{"$regularExpression":{{"pattern":"{}","options":"{}"}}}}"#,
                    escape_json_string(&pattern),
                    flags
                ));
                i = end;
                continue;
            }
        }

        // Regex literal: /pattern/flags — only in value position (after : or , or [ or start)
        if chars[i] == '/' && !in_regex_unlikely_position(&result) {
            if let Some((pattern, flags, end)) = extract_regex_literal(&chars, i) {
                result.push_str(&format!(
                    r#"{{"$regularExpression":{{"pattern":"{}","options":"{}"}}}}"#,
                    escape_json_string(&pattern),
                    flags
                ));
                i = end;
                continue;
            }
        }

        // No match — if we consumed "new " but nothing matched, emit it as-is
        if after_new != i {
            result.push_str("new ");
            i = after_new;
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    result
}

/// Check if `/` is likely division, not regex start.
/// Returns true if the last non-whitespace char suggests division (number, identifier end, closing bracket).
fn in_regex_unlikely_position(preceding: &str) -> bool {
    let last = preceding.trim_end().chars().last();
    matches!(last, Some(')') | Some(']') | Some('0'..='9'))
}

/// Extract regex literal /pattern/flags
fn extract_regex_literal(chars: &[char], start: usize) -> Option<(String, String, usize)> {
    if start >= chars.len() || chars[start] != '/' {
        return None;
    }
    let mut i = start + 1;
    let mut pattern = String::new();
    let mut escaped = false;

    // Read pattern (handle escaped /)
    while i < chars.len() {
        if escaped {
            pattern.push(chars[i]);
            escaped = false;
        } else if chars[i] == '\\' {
            pattern.push('\\');
            escaped = true;
        } else if chars[i] == '/' {
            break;
        } else if chars[i] == '\n' {
            return None; // regex can't span lines
        } else {
            pattern.push(chars[i]);
        }
        i += 1;
    }
    if i >= chars.len() || chars[i] != '/' {
        return None;
    }
    if pattern.is_empty() {
        return None; // empty regex `/` `/` is likely not a regex
    }
    i += 1; // skip closing /

    // Read flags
    let mut flags = String::new();
    while i < chars.len() && chars[i].is_ascii_alphabetic() {
        flags.push(chars[i]);
        i += 1;
    }
    // Sort flags alphabetically (MongoDB convention)
    let mut flag_chars: Vec<char> = flags.chars().collect();
    flag_chars.sort();
    let flags: String = flag_chars.into_iter().collect();

    Some((pattern, flags, i))
}

/// Extract RegExp('pattern', 'flags') or RegExp('pattern')
fn extract_regexp_args(chars: &[char], start: usize) -> Option<(String, String, usize)> {
    // First arg: pattern (quoted string)
    let (pattern, after_pattern) = {
        let mut i = start;
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
        let mut val = String::new();
        while i < chars.len() && chars[i] != quote {
            val.push(chars[i]);
            i += 1;
        }
        if i >= chars.len() {
            return None;
        }
        i += 1; // skip closing quote
        (val, i)
    };

    let mut i = after_pattern;
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }

    // Check for optional second arg (flags)
    if i < chars.len() && chars[i] == ',' {
        i += 1;
        // Extract flags string
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
        let mut flags = String::new();
        while i < chars.len() && chars[i] != quote {
            flags.push(chars[i]);
            i += 1;
        }
        if i >= chars.len() {
            return None;
        }
        i += 1; // skip closing quote
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i < chars.len() && chars[i] == ')' {
            Some((pattern, flags, i + 1))
        } else {
            None
        }
    } else if i < chars.len() && chars[i] == ')' {
        Some((pattern, String::new(), i + 1))
    } else {
        None
    }
}

/// Escape a string for JSON embedding (handle backslashes and double quotes)
fn escape_json_string(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => result.push_str("\\\""),
            '\\' => result.push_str("\\\\"),
            '\n' => result.push_str("\\n"),
            '\t' => result.push_str("\\t"),
            '\r' => result.push_str("\\r"),
            _ => result.push(c),
        }
    }
    result
}

/// Extract the string argument from a helper call like ('...') or ("...")
/// Returns (value, position after closing paren)
fn extract_helper_arg(chars: &[char], start: usize) -> Option<(String, usize)> {
    let mut i = start;
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
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    if i < chars.len() && chars[i] == ')' {
        Some((value, i + 1))
    } else {
        None
    }
}

/// Extract empty argument: just whitespace then closing paren — e.g. ObjectId(), new Date()
fn extract_empty_arg(chars: &[char], start: usize) -> Option<usize> {
    let mut i = start;
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    if i < chars.len() && chars[i] == ')' {
        Some(i + 1)
    } else {
        None
    }
}

/// Extract a numeric argument (int or float, possibly negative) — e.g. NumberLong(123), Date(1234567890000)
fn extract_numeric_arg(chars: &[char], start: usize) -> Option<(String, usize)> {
    let mut i = start;
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    let num_start = i;
    if i < chars.len() && chars[i] == '-' {
        i += 1;
    }
    let mut has_digits = false;
    while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
        has_digits = true;
        i += 1;
    }
    if !has_digits {
        return None;
    }
    let value: String = chars[num_start..i].iter().collect();
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    if i < chars.len() && chars[i] == ')' {
        Some((value, i + 1))
    } else {
        None
    }
}

/// Extract two numeric args — e.g. Timestamp(1234567890, 1)
fn extract_two_numeric_args(chars: &[char], start: usize) -> Option<(String, String, usize)> {
    let (first, after_first) = extract_numeric_arg_no_close(chars, start)?;
    let mut i = after_first;
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    if i >= chars.len() || chars[i] != ',' {
        return None;
    }
    i += 1; // skip comma
    let (second, after_second) = extract_numeric_arg_no_close(chars, i)?;
    let mut j = after_second;
    while j < chars.len() && chars[j].is_whitespace() {
        j += 1;
    }
    if j < chars.len() && chars[j] == ')' {
        Some((first, second, j + 1))
    } else {
        None
    }
}

/// Helper: extract numeric value without consuming closing paren
fn extract_numeric_arg_no_close(chars: &[char], start: usize) -> Option<(String, usize)> {
    let mut i = start;
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    let num_start = i;
    if i < chars.len() && chars[i] == '-' {
        i += 1;
    }
    let mut has_digits = false;
    while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
        has_digits = true;
        i += 1;
    }
    if !has_digits {
        return None;
    }
    let value: String = chars[num_start..i].iter().collect();
    Some((value, i))
}

/// Extract BinData args — e.g. BinData(0, 'base64string')
fn extract_bindata_args(chars: &[char], start: usize) -> Option<(String, String, usize)> {
    let (subtype, after_sub) = extract_numeric_arg_no_close(chars, start)?;
    let mut i = after_sub;
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    if i >= chars.len() || chars[i] != ',' {
        return None;
    }
    i += 1; // skip comma
    let (data, end) = extract_helper_arg_inner(chars, i)?;
    Some((subtype, data, end))
}

/// Like extract_helper_arg but reusable — extracts quoted string + closing paren
fn extract_helper_arg_inner(chars: &[char], start: usize) -> Option<(String, usize)> {
    extract_helper_arg(chars, start)
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
        bson::Bson::RegularExpression(re) => {
            serde_json::json!({"$regularExpression": {"pattern": re.pattern, "options": re.options}})
        }
        bson::Bson::Timestamp(ts) => {
            serde_json::json!({"$timestamp": {"t": ts.time, "i": ts.increment}})
        }
        bson::Bson::MinKey => serde_json::json!({"$minKey": 1}),
        bson::Bson::MaxKey => serde_json::json!({"$maxKey": 1}),
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
                None => {
                    if let Some(pipeline) = &request.pipeline {
                        if let Some(filter_val) = pipeline.iter().find_map(|s| s.get("$match")) {
                            json_to_bson_doc(filter_val)?
                        } else {
                            doc! {}
                        }
                    } else {
                        doc! {}
                    }
                }
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
                None => {
                    if let Some(pipeline) = &request.pipeline {
                        if let Some(filter_val) = pipeline.iter().find_map(|s| s.get("$match")) {
                            json_to_bson_doc(filter_val)?
                        } else {
                            doc! {}
                        }
                    } else {
                        doc! {}
                    }
                }
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
                None => {
                    if let Some(pipeline) = &request.pipeline {
                        if let Some(filter_val) = pipeline.iter().find_map(|s| s.get("$match")) {
                            json_to_bson_doc(filter_val)?
                        } else {
                            doc! {}
                        }
                    } else {
                        doc! {}
                    }
                }
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

            let field_name = request.sort
                .as_ref()
                .and_then(|v| v.as_str())
                .unwrap_or("_id");

            let docs = collection
                .distinct(field_name, filter)
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
        QueryType::CountDocuments => {
            // countDocuments() uses the same count_documents driver method as Count
            let filter = match &request.filter {
                Some(f) => json_to_bson_doc(f)?,
                None => doc! {},
            };

            let count = collection
                .count_documents(filter)
                .await
                .map_err(|e| format!("CountDocuments failed: {}", e))?;

            Ok(QueryResult {
                documents: vec![serde_json::json!({ "count": count })],
                has_more: false,
                query_type: QueryType::CountDocuments,
                page: 1,
                page_size: 1,
            })
        }
        QueryType::EstimatedDocumentCount => {
            let count = collection
                .estimated_document_count()
                .await
                .map_err(|e| format!("EstimatedDocumentCount failed: {}", e))?;

            Ok(QueryResult {
                documents: vec![serde_json::json!({ "count": count })],
                has_more: false,
                query_type: QueryType::EstimatedDocumentCount,
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
    let query_text = strip_comments(query_text.trim());
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
            if parts.len() < 2 || parts[1].trim().is_empty() {
                let method = match parsed.query_type {
                    QueryType::UpdateOne => "updateOne",
                    QueryType::UpdateMany => "updateMany",
                    QueryType::ReplaceOne => "replaceOne",
                    _ => "update",
                };
                return Err(format!("{} requires both a filter and an update/replacement document", method));
            }
            let filter: Option<serde_json::Value> = if parts[0].trim().is_empty() || parts[0].trim() == "{}" {
                None
            } else {
                Some(json5::from_str(&parts[0]).map_err(|e| {
                    format!("Invalid filter: {}. Input: {}", e, parts[0])
                })?)
            };
            let update: Option<serde_json::Value> = Some(json5::from_str(&parts[1]).map_err(|e| {
                format!("Invalid update: {}. Input: {}", e, parts[1])
            })?);
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
            // distinct("fieldName") or distinct("fieldName", {filter})
            let parts = split_top_level_args(&parsed.args);
            let field_name = parts.first()
                .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
                .unwrap_or_default();
            if field_name.is_empty() {
                return Err("distinct() requires a field name argument".to_string());
            }
            let filter: Option<serde_json::Value> = if parts.len() > 1 && !parts[1].trim().is_empty() && parts[1].trim() != "{}" {
                Some(json5::from_str(&parts[1]).map_err(|e| {
                    format!("Invalid filter: {}. Input: {}", e, parts[1])
                })?)
            } else {
                None
            };
            // Pass field name through sort field (unused for distinct)
            QueryRequest {
                db,
                collection: parsed.collection,
                query_type: QueryType::Distinct,
                filter,
                pipeline: None,
                page: None,
                page_size: None,
                sort: Some(serde_json::Value::String(field_name)),
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
        QueryType::CountDocuments => {
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
                query_type: QueryType::CountDocuments,
                filter,
                pipeline: None,
                page: None,
                page_size: None,
                sort: None,
                projection: None,
            }
        }
        QueryType::EstimatedDocumentCount => {
            QueryRequest {
                db,
                collection: parsed.collection,
                query_type: QueryType::EstimatedDocumentCount,
                filter: None,
                pipeline: None,
                page: None,
                page_size: None,
                sort: None,
                projection: None,
            }
        }
        QueryType::Other => {
            return Err(format!(
                "Unsupported method: {}. Supported methods: find, findOne, aggregate, count, countDocuments, estimatedDocumentCount, distinct, insertOne, insertMany, updateOne, updateMany, replaceOne, deleteOne, deleteMany, findOneAndUpdate, findOneAndDelete, findOneAndReplace",
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
    collation: Option<String>,
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
    let mut escaped = false;

    for ch in input.chars() {
        if in_string {
            current.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
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
        "countDocuments" => QueryType::CountDocuments,
        "estimatedDocumentCount" => QueryType::EstimatedDocumentCount,
        _ => QueryType::Other,
    };

    let mut sort = None;
    let mut projection = None;
    let mut limit = None;
    let mut collation = None;

    // Parse method chains (.sort(), .limit(), .skip(), .projection(), .collation())
    // Supported on Find and other read operations
    if matches!(query_type, QueryType::Find | QueryType::FindOne | QueryType::Count | QueryType::CountDocuments) {
        let remainder = &method_part[close_pos + 1..];
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
            } else if rest.starts_with("collation(") {
                let paren_start = rest.find('(').unwrap();
                if let Some(close) = find_matching_close(rest, paren_start) {
                    collation = Some(rest[paren_start + 1..close].trim().to_string());
                    rest = &rest[close + 1..];
                } else {
                    break;
                }
            } else if rest.starts_with("toArray(") || rest.starts_with("explain(") {
                // Silently skip — toArray is implicit, explain not yet supported
                if let Some(close) = rest.find(')') {
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
        collation,
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

    // ─── preprocess: new ObjectId ───

    #[test]
    fn preprocess_new_objectid() {
        let input = r#"{_id: new ObjectId('507f1f77bcf86cd799439011')}"#;
        let result = preprocess_mongo_helpers(input);
        assert!(result.contains(r#"{"$oid":"507f1f77bcf86cd799439011"}"#));
        assert!(!result.contains("new ObjectId"));
    }

    // ─── preprocess: new Date() empty (current time) ───

    #[test]
    fn preprocess_new_date_empty() {
        let result = preprocess_mongo_helpers(r#"{created: new Date()}"#);
        assert!(result.contains(r#"{"$date":"#));
        assert!(!result.contains("new Date"));
    }

    #[test]
    fn preprocess_isodate_empty() {
        let result = preprocess_mongo_helpers(r#"{created: ISODate()}"#);
        assert!(result.contains(r#"{"$date":"#));
        assert!(!result.contains("ISODate"));
    }

    // ─── preprocess: Date(millis) ───

    #[test]
    fn preprocess_new_date_millis() {
        let result = preprocess_mongo_helpers(r#"{created: new Date(1724054400000)}"#);
        assert!(result.contains(r#"{"$date":{"$numberLong":"1724054400000"}}"#));
        assert!(!result.contains("new Date"));
    }

    // ─── preprocess: NumberInt ───

    #[test]
    fn preprocess_number_int_string() {
        let result = preprocess_mongo_helpers(r#"{count: NumberInt('42')}"#);
        assert!(result.contains(r#"{"$numberInt":"42"}"#));
        assert!(!result.contains("NumberInt"));
    }

    #[test]
    fn preprocess_number_int_numeric() {
        let result = preprocess_mongo_helpers(r#"{count: NumberInt(42)}"#);
        assert!(result.contains(r#"{"$numberInt":"42"}"#));
    }

    // ─── preprocess: NumberLong numeric arg ───

    #[test]
    fn preprocess_number_long_numeric() {
        let result = preprocess_mongo_helpers(r#"{count: NumberLong(9999)}"#);
        assert!(result.contains(r#"{"$numberLong":"9999"}"#));
    }

    // ─── preprocess: NumberDecimal numeric arg ───

    #[test]
    fn preprocess_number_decimal_numeric() {
        let result = preprocess_mongo_helpers(r#"{price: NumberDecimal(99.99)}"#);
        assert!(result.contains(r#"{"$numberDecimal":"99.99"}"#));
    }

    // ─── preprocess: Timestamp ───

    #[test]
    fn preprocess_timestamp() {
        let result = preprocess_mongo_helpers(r#"{ts: Timestamp(1724054400, 1)}"#);
        assert!(result.contains(r#"{"$timestamp":{"t":1724054400,"i":1}}"#));
        assert!(!result.contains("Timestamp"));
    }

    #[test]
    fn preprocess_timestamp_empty() {
        let result = preprocess_mongo_helpers(r#"{ts: Timestamp()}"#);
        assert!(result.contains(r#"{"$timestamp":{"t":"#));
        assert!(!result.contains("Timestamp()"));
    }

    // ─── preprocess: UUID ───

    #[test]
    fn preprocess_uuid() {
        let result = preprocess_mongo_helpers(r#"{uid: UUID('550e8400-e29b-41d4-a716-446655440000')}"#);
        assert!(result.contains(r#"{"$uuid":"550e8400-e29b-41d4-a716-446655440000"}"#));
        assert!(!result.contains("UUID("));
    }

    // ─── preprocess: BinData ───

    #[test]
    fn preprocess_bindata() {
        let result = preprocess_mongo_helpers(r#"{data: BinData(0, 'SGVsbG8=')}"#);
        assert!(result.contains(r#"{"$binary":{"base64":"SGVsbG8=","subType":"0"}}"#));
        assert!(!result.contains("BinData"));
    }

    // ─── preprocess: MinKey / MaxKey ───

    #[test]
    fn preprocess_minkey() {
        let result = preprocess_mongo_helpers(r#"{low: MinKey}"#);
        assert!(result.contains(r#"{"$minKey":1}"#));
        assert!(!result.contains("MinKey}"));
    }

    #[test]
    fn preprocess_maxkey() {
        let result = preprocess_mongo_helpers(r#"{high: MaxKey}"#);
        assert!(result.contains(r#"{"$maxKey":1}"#));
        assert!(!result.contains("MaxKey}"));
    }

    #[test]
    fn preprocess_minkey_with_parens() {
        let result = preprocess_mongo_helpers(r#"{low: MinKey()}"#);
        assert!(result.contains(r#"{"$minKey":1}"#));
    }

    #[test]
    fn preprocess_maxkey_with_parens() {
        let result = preprocess_mongo_helpers(r#"{high: MaxKey()}"#);
        assert!(result.contains(r#"{"$maxKey":1}"#));
    }

    // ─── preprocess: Long() should not match NumberLong ───

    #[test]
    fn preprocess_long_does_not_eat_numberlong() {
        let input = r#"{a: NumberLong('123'), b: Long('456')}"#;
        let result = preprocess_mongo_helpers(input);
        assert!(result.contains(r#"{"$numberLong":"123"}"#));
        assert!(result.contains(r#"{"$numberLong":"456"}"#));
    }

    // ─── preprocess: mixed helpers in one doc ───

    #[test]
    fn preprocess_all_helpers_combined() {
        let input = r#"{
            _id: ObjectId('507f1f77bcf86cd799439011'),
            created: new Date('2024-01-15T10:30:00.000Z'),
            updated: ISODate('2026-08-31T07:00:00.000Z'),
            count: NumberLong(100),
            price: NumberDecimal('99.99'),
            rank: NumberInt(5),
            ts: Timestamp(1724054400, 1),
            uid: UUID('550e8400-e29b-41d4-a716-446655440000'),
            low: MinKey,
            high: MaxKey
        }"#;
        let result = preprocess_mongo_helpers(input);
        assert!(result.contains(r#"{"$oid":"507f1f77bcf86cd799439011"}"#));
        assert!(result.contains(r#"{"$date":"2024-01-15T10:30:00.000Z"}"#));
        assert!(result.contains(r#"{"$date":"2026-08-31T07:00:00.000Z"}"#));
        assert!(result.contains(r#"{"$numberLong":"100"}"#));
        assert!(result.contains(r#"{"$numberDecimal":"99.99"}"#));
        assert!(result.contains(r#"{"$numberInt":"5"}"#));
        assert!(result.contains(r#"{"$timestamp":{"t":1724054400,"i":1}}"#));
        assert!(result.contains(r#"{"$uuid":"550e8400-e29b-41d4-a716-446655440000"}"#));
        assert!(result.contains(r#"{"$minKey":1}"#));
        assert!(result.contains(r#"{"$maxKey":1}"#));
    }

    // ─── json_value_to_bson: Timestamp ───

    #[test]
    fn json_to_bson_timestamp() {
        let json: serde_json::Value = serde_json::json!({"$timestamp": {"t": 1724054400, "i": 1}});
        let bson = json_value_to_bson(&json);
        if let bson::Bson::Timestamp(ts) = bson {
            assert_eq!(ts.time, 1724054400);
            assert_eq!(ts.increment, 1);
        } else {
            panic!("Expected Timestamp, got {:?}", bson);
        }
    }

    // ─── json_value_to_bson: MinKey / MaxKey ───

    #[test]
    fn json_to_bson_minkey() {
        let json: serde_json::Value = serde_json::json!({"$minKey": 1});
        let bson = json_value_to_bson(&json);
        assert!(matches!(bson, bson::Bson::MinKey));
    }

    #[test]
    fn json_to_bson_maxkey() {
        let json: serde_json::Value = serde_json::json!({"$maxKey": 1});
        let bson = json_value_to_bson(&json);
        assert!(matches!(bson, bson::Bson::MaxKey));
    }

    // ─── json_value_to_bson: NumberInt ───

    #[test]
    fn json_to_bson_number_int() {
        let json: serde_json::Value = serde_json::json!({"$numberInt": "42"});
        let bson = json_value_to_bson(&json);
        assert!(matches!(bson, bson::Bson::Int32(42)));
    }

    // ─── save pipeline: new helpers ───

    #[test]
    fn save_pipeline_new_date_empty() {
        let input = r#"{"created": new Date()}"#;
        let preprocessed = preprocess_mongo_helpers(input);
        let json: serde_json::Value = json5::from_str(&preprocessed).unwrap();
        let doc = json_to_bson_doc(&json).unwrap();
        assert!(matches!(doc.get("created"), Some(bson::Bson::DateTime(_))));
    }

    #[test]
    fn save_pipeline_isodate_empty() {
        let input = r#"{"created": ISODate()}"#;
        let preprocessed = preprocess_mongo_helpers(input);
        let json: serde_json::Value = json5::from_str(&preprocessed).unwrap();
        let doc = json_to_bson_doc(&json).unwrap();
        assert!(matches!(doc.get("created"), Some(bson::Bson::DateTime(_))));
    }

    #[test]
    fn save_pipeline_number_int() {
        let input = r#"{"rank": NumberInt(5)}"#;
        let preprocessed = preprocess_mongo_helpers(input);
        let json: serde_json::Value = json5::from_str(&preprocessed).unwrap();
        let doc = json_to_bson_doc(&json).unwrap();
        assert!(matches!(doc.get("rank"), Some(bson::Bson::Int32(5))));
    }

    #[test]
    fn save_pipeline_timestamp() {
        let input = r#"{"ts": Timestamp(1724054400, 1)}"#;
        let preprocessed = preprocess_mongo_helpers(input);
        let json: serde_json::Value = json5::from_str(&preprocessed).unwrap();
        let doc = json_to_bson_doc(&json).unwrap();
        if let Some(bson::Bson::Timestamp(ts)) = doc.get("ts") {
            assert_eq!(ts.time, 1724054400);
            assert_eq!(ts.increment, 1);
        } else {
            panic!("Expected Timestamp");
        }
    }

    #[test]
    fn save_pipeline_minkey_maxkey() {
        let input = r#"{"low": MinKey, "high": MaxKey}"#;
        let preprocessed = preprocess_mongo_helpers(input);
        let json: serde_json::Value = json5::from_str(&preprocessed).unwrap();
        let doc = json_to_bson_doc(&json).unwrap();
        assert!(matches!(doc.get("low"), Some(bson::Bson::MinKey)));
        assert!(matches!(doc.get("high"), Some(bson::Bson::MaxKey)));
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

    // ─── preprocess: RegExp ───

    #[test]
    fn preprocess_regexp_pattern_only() {
        let result = preprocess_mongo_helpers(r#"{name: RegExp('test')}"#);
        assert!(result.contains(r#"{"$regularExpression":{"pattern":"test","options":""}}"#));
        assert!(!result.contains("RegExp("));
    }

    #[test]
    fn preprocess_regexp_with_flags() {
        let result = preprocess_mongo_helpers(r#"{name: RegExp('test', 'i')}"#);
        assert!(result.contains(r#"{"$regularExpression":{"pattern":"test","options":"i"}}"#));
    }

    #[test]
    fn preprocess_regexp_double_quotes() {
        let result = preprocess_mongo_helpers(r#"{name: RegExp("^hello", "im")}"#);
        assert!(result.contains(r#"{"$regularExpression":{"pattern":"^hello","options":"im"}}"#));
    }

    // ─── preprocess: regex literal ───

    #[test]
    fn preprocess_regex_literal_simple() {
        let result = preprocess_mongo_helpers(r#"{name: /test/i}"#);
        assert!(result.contains(r#"{"$regularExpression":{"pattern":"test","options":"i"}}"#));
    }

    #[test]
    fn preprocess_regex_literal_no_flags() {
        let result = preprocess_mongo_helpers(r#"{name: /^hello/}"#);
        assert!(result.contains(r#"{"$regularExpression":{"pattern":"^hello","options":""}}"#));
    }

    #[test]
    fn preprocess_regex_literal_multiple_flags() {
        let result = preprocess_mongo_helpers(r#"{name: /test/gim}"#);
        // Flags should be sorted
        assert!(result.contains(r#""options":"gim""#));
    }

    #[test]
    fn preprocess_regex_literal_escaped_slash() {
        let result = preprocess_mongo_helpers(r#"{path: /a\/b/}"#);
        assert!(result.contains(r#""pattern":"a\\/b""#));
    }

    // ─── json_value_to_bson: RegularExpression ───

    #[test]
    fn json_to_bson_regex() {
        let json: serde_json::Value = serde_json::json!({"$regularExpression": {"pattern": "test", "options": "i"}});
        let bson = json_value_to_bson(&json);
        if let bson::Bson::RegularExpression(re) = bson {
            assert_eq!(re.pattern, "test");
            assert_eq!(re.options, "i");
        } else {
            panic!("Expected RegularExpression, got {:?}", bson);
        }
    }

    // ─── bson_to_json_value: RegularExpression round-trip ───

    #[test]
    fn roundtrip_regex() {
        let bson_val = bson::Bson::RegularExpression(bson::Regex {
            pattern: "test".to_string(),
            options: "i".to_string(),
        });
        let json = bson_to_json_value(&bson_val);
        assert_eq!(json, serde_json::json!({"$regularExpression": {"pattern": "test", "options": "i"}}));
        let back = json_value_to_bson(&json);
        if let bson::Bson::RegularExpression(re) = back {
            assert_eq!(re.pattern, "test");
            assert_eq!(re.options, "i");
        } else {
            panic!("Expected RegularExpression, got {:?}", back);
        }
    }

    // ─── save pipeline: regex ───

    #[test]
    fn save_pipeline_regexp() {
        let input = r#"{"name": RegExp('hello', 'i')}"#;
        let preprocessed = preprocess_mongo_helpers(input);
        let json: serde_json::Value = json5::from_str(&preprocessed).unwrap();
        let doc = json_to_bson_doc(&json).unwrap();
        if let Some(bson::Bson::RegularExpression(re)) = doc.get("name") {
            assert_eq!(re.pattern, "hello");
            assert_eq!(re.options, "i");
        } else {
            panic!("Expected RegularExpression");
        }
    }

    #[test]
    fn save_pipeline_regex_literal() {
        let input = r#"{"name": /^test/i}"#;
        let preprocessed = preprocess_mongo_helpers(input);
        let json: serde_json::Value = json5::from_str(&preprocessed).unwrap();
        let doc = json_to_bson_doc(&json).unwrap();
        if let Some(bson::Bson::RegularExpression(re)) = doc.get("name") {
            assert_eq!(re.pattern, "^test");
            assert_eq!(re.options, "i");
        } else {
            panic!("Expected RegularExpression");
        }
    }

    // ─── roundtrip: Timestamp ───

    #[test]
    fn roundtrip_timestamp() {
        let bson_val = bson::Bson::Timestamp(bson::Timestamp { time: 1724054400, increment: 1 });
        let json = bson_to_json_value(&bson_val);
        assert_eq!(json, serde_json::json!({"$timestamp": {"t": 1724054400, "i": 1}}));
        let back = json_value_to_bson(&json);
        if let bson::Bson::Timestamp(ts) = back {
            assert_eq!(ts.time, 1724054400);
            assert_eq!(ts.increment, 1);
        } else {
            panic!("Expected Timestamp, got {:?}", back);
        }
    }

    // ─── roundtrip: MinKey / MaxKey ───

    #[test]
    fn roundtrip_minkey() {
        let bson_val = bson::Bson::MinKey;
        let json = bson_to_json_value(&bson_val);
        assert_eq!(json, serde_json::json!({"$minKey": 1}));
        let back = json_value_to_bson(&json);
        assert!(matches!(back, bson::Bson::MinKey));
    }

    #[test]
    fn roundtrip_maxkey() {
        let bson_val = bson::Bson::MaxKey;
        let json = bson_to_json_value(&bson_val);
        assert_eq!(json, serde_json::json!({"$maxKey": 1}));
        let back = json_value_to_bson(&json);
        assert!(matches!(back, bson::Bson::MaxKey));
    }

    // ─── strip_comments ───

    #[test]
    fn strip_line_comment() {
        let input = "db.users.find({}) // find all users";
        let result = strip_comments(input);
        assert_eq!(result.trim(), "db.users.find({})");
    }

    #[test]
    fn strip_block_comment() {
        let input = "db.users.find(/* filter */ {})";
        let result = strip_comments(input);
        assert_eq!(result, "db.users.find( {})");
    }

    #[test]
    fn strip_multiline_block_comment() {
        let input = "db.users.find(\n/* \n  multi\n  line\n*/\n{})";
        let result = strip_comments(input);
        assert_eq!(result, "db.users.find(\n\n{})");
    }

    #[test]
    fn strip_comments_preserves_strings() {
        let input = r#"db.users.find({url: "http://example.com"})"#;
        let result = strip_comments(input);
        assert_eq!(result, input); // URL inside string should not be stripped
    }

    #[test]
    fn strip_comments_preserves_single_quote_strings() {
        let input = "db.users.find({url: 'http://example.com'})";
        let result = strip_comments(input);
        assert_eq!(result, input);
    }

    #[test]
    fn strip_mixed_comments() {
        let input = "// header comment\ndb.users.find({}) /* trailing */";
        let result = strip_comments(input);
        assert_eq!(result.trim(), "db.users.find({})");
    }

    // ─── parse_query_string: countDocuments / estimatedDocumentCount ───

    #[test]
    fn parse_count_documents() {
        let parsed = parse_query_string("db.users.countDocuments({active: true})").unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::CountDocuments));
        assert!(parsed.args.contains("active"));
    }

    #[test]
    fn parse_count_documents_empty() {
        let parsed = parse_query_string("db.users.countDocuments({})").unwrap();
        assert!(matches!(parsed.query_type, QueryType::CountDocuments));
    }

    #[test]
    fn parse_count_documents_no_args() {
        let parsed = parse_query_string("db.users.countDocuments()").unwrap();
        assert!(matches!(parsed.query_type, QueryType::CountDocuments));
        assert!(parsed.args.is_empty());
    }

    #[test]
    fn parse_estimated_document_count() {
        let parsed = parse_query_string("db.users.estimatedDocumentCount()").unwrap();
        assert_eq!(parsed.collection, "users");
        assert!(matches!(parsed.query_type, QueryType::EstimatedDocumentCount));
    }

    // ─── parse_query_string: collation chain ───

    #[test]
    fn parse_find_with_collation() {
        let parsed = parse_query_string(r#"db.users.find({}).collation({locale: "en", strength: 2})"#).unwrap();
        assert!(matches!(parsed.query_type, QueryType::Find));
        assert!(parsed.collation.is_some());
        assert!(parsed.collation.as_ref().unwrap().contains("locale"));
    }

    // ─── parse_query_string: toArray / explain are silently skipped ───

    #[test]
    fn parse_find_with_toarray() {
        let parsed = parse_query_string("db.users.find({}).toArray()").unwrap();
        assert!(matches!(parsed.query_type, QueryType::Find));
    }

    #[test]
    fn parse_find_with_explain() {
        let parsed = parse_query_string("db.users.find({}).explain()").unwrap();
        assert!(matches!(parsed.query_type, QueryType::Find));
    }

    #[test]
    fn parse_find_full_chain() {
        let parsed = parse_query_string(r#"db.users.find({}).sort({name: 1}).limit(10).collation({locale: "en"}).toArray()"#).unwrap();
        assert!(matches!(parsed.query_type, QueryType::Find));
        assert_eq!(parsed.sort.as_deref(), Some("{name: 1}"));
        assert_eq!(parsed.limit, Some(10));
        assert!(parsed.collation.is_some());
    }

    // ─── parse_query_string: countDocuments with chain ───

    #[test]
    fn parse_count_documents_with_collation() {
        let parsed = parse_query_string(r#"db.users.countDocuments({}).collation({locale: "fr"})"#).unwrap();
        assert!(matches!(parsed.query_type, QueryType::CountDocuments));
        assert!(parsed.collation.is_some());
    }

    // ─── regex: not matching division ───

    #[test]
    fn regex_not_after_number() {
        // 10/2 should not be treated as regex
        let result = preprocess_mongo_helpers(r#"{result: 10/2}"#);
        assert!(!result.contains("$regularExpression"));
    }

    #[test]
    fn regex_not_after_paren() {
        // (a)/b should not be treated as regex
        let result = preprocess_mongo_helpers(r#"{result: (a)/b}"#);
        assert!(!result.contains("$regularExpression"));
    }

    // ─── json_value_to_bson: UUID ───

    #[test]
    fn json_to_bson_uuid() {
        let json: serde_json::Value = serde_json::json!({"$uuid": "550e8400-e29b-41d4-a716-446655440000"});
        let bson = json_value_to_bson(&json);
        // UUID is stored as a Document with $uuid key
        if let bson::Bson::Document(doc) = bson {
            assert!(doc.get_str("$uuid").is_ok());
        } else {
            panic!("Expected Document with $uuid, got {:?}", bson);
        }
    }

    // ─── json_value_to_bson: BinData / $binary ───

    #[test]
    fn save_pipeline_bindata() {
        let input = r#"{"data": BinData(0, 'SGVsbG8=')}"#;
        let preprocessed = preprocess_mongo_helpers(input);
        let json: serde_json::Value = json5::from_str(&preprocessed).unwrap();
        assert!(json.get("data").unwrap().get("$binary").is_some());
    }

    // ─── full pipeline: comments + helpers ───

    #[test]
    fn full_pipeline_with_comments() {
        let input = r#"// Find active users
{active: true, created: new Date('2024-01-15T00:00:00Z') /* after jan */}"#;
        let stripped = strip_comments(input);
        let preprocessed = preprocess_mongo_helpers(&stripped);
        let json: serde_json::Value = json5::from_str(&preprocessed).unwrap();
        let doc = json_to_bson_doc(&json).unwrap();
        assert!(matches!(doc.get("active"), Some(bson::Bson::Boolean(true))));
        assert!(matches!(doc.get("created"), Some(bson::Bson::DateTime(_))));
    }

    // ─── new RegExp ───

    #[test]
    fn preprocess_new_regexp() {
        let result = preprocess_mongo_helpers(r#"{name: new RegExp('test', 'i')}"#);
        assert!(result.contains(r#"{"$regularExpression":{"pattern":"test","options":"i"}}"#));
        assert!(!result.contains("new RegExp"));
    }

    // ─── Bug fix: distinct field name extraction ───

    #[test]
    fn parse_distinct_extracts_field_name() {
        let query = r#"db.users.distinct("city")"#;
        let parsed = parse_query_string(query).unwrap();
        assert!(matches!(parsed.query_type, QueryType::Distinct));
        assert_eq!(parsed.args, r#""city""#);
    }

    #[test]
    fn parse_distinct_with_filter() {
        let query = r#"db.users.distinct("city", {active: true})"#;
        let parsed = parse_query_string(query).unwrap();
        assert!(matches!(parsed.query_type, QueryType::Distinct));
    }

    // ─── Bug fix: updateMany/replaceOne requires both args ───

    #[test]
    fn parse_update_many_multiline_with_helpers() {
        // This is the exact query from the bug report
        let query = r#"db.creditdailyalerts.updateMany(
  {
    type: 'YOLDEE_DISCONNECTED',
    isDeleted: { $ne: true }
  },
  {
    $set: {
      status: 'done',
      updatedAt: new Date()
    }
  }
)"#;
        let parsed = parse_query_string(query).unwrap();
        assert!(matches!(parsed.query_type, QueryType::UpdateMany));
        assert_eq!(parsed.collection, "creditdailyalerts");
        // Ensure both filter and update are present in args
        let parts = split_top_level_args(&parsed.args);
        assert_eq!(parts.len(), 2);
        assert!(parts[0].contains("YOLDEE_DISCONNECTED"));
        assert!(parts[1].contains("$set"));
    }

    // ─── Bug fix: strip_comments handles escaped quotes ───

    #[test]
    fn strip_comments_escaped_quotes() {
        let input = r#"{msg: "say \"hi\" // not a comment"}"#;
        let result = strip_comments(input);
        assert_eq!(result, input); // nothing should be stripped
    }

    // ─── Bug fix: split_top_level_args handles escaped quotes ───

    #[test]
    fn split_args_escaped_quotes() {
        let input = r#"{"name": "he said \"hi\""}, {"$set": {"b": 1}}"#;
        let parts = split_top_level_args(input);
        assert_eq!(parts.len(), 2);
        assert!(parts[0].contains(r#"\"hi\""#));
        assert!(parts[1].contains("$set"));
    }

    // ─── Bug fix: chain parsing offset correctness ───

    #[test]
    fn parse_find_sort_short_collection() {
        // Short collection name — previously the chain offset bug could miss this
        let parsed = parse_query_string(r#"db.u.find({}).sort({a: -1})"#).unwrap();
        assert!(matches!(parsed.query_type, QueryType::Find));
        assert_eq!(parsed.sort.as_deref(), Some("{a: -1}"));
    }

    #[test]
    fn parse_find_sort_long_collection() {
        let parsed = parse_query_string(r#"db.very_long_collection_name.find({}).sort({x: 1}).limit(5)"#).unwrap();
        assert!(matches!(parsed.query_type, QueryType::Find));
        assert_eq!(parsed.sort.as_deref(), Some("{x: 1}"));
        assert_eq!(parsed.limit, Some(5));
    }

    // ─── Bug fix: multi-byte UTF-8 in preprocess ───

    #[test]
    fn preprocess_helpers_with_unicode() {
        // Ensure multi-byte chars before helpers don't panic
        let input = r#"{name: "日本語", created: new Date()}"#;
        let result = preprocess_mongo_helpers(input);
        assert!(result.contains("日本語"));
        assert!(result.contains(r#"{"$date":"#));
        assert!(!result.contains("new Date"));
    }

    #[test]
    fn preprocess_helpers_with_emoji() {
        let input = r#"{emoji: "🎉", id: ObjectId('507f1f77bcf86cd799439011')}"#;
        let result = preprocess_mongo_helpers(input);
        assert!(result.contains("🎉"));
        assert!(result.contains(r#"{"$oid":"507f1f77bcf86cd799439011"}"#));
    }
}
