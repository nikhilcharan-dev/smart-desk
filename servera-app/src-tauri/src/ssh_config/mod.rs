pub mod parser;
pub mod resolver;
pub mod mapper;



#[derive(serde::Serialize)]
pub struct DetectResult {
    pub path: String,
    pub exists: bool,
    pub entry_count: usize,
    pub last_modified: Option<u64>,
}

#[derive(serde::Serialize)]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}
