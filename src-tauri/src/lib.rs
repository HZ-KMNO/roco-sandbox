use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn cache_path(app: &tauri::AppHandle) -> PathBuf {
    let mut dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    fs::create_dir_all(&dir).ok();
    dir.push("popular_teams_cache.json");
    dir
}

#[tauri::command]
async fn fetch_popular_teams(app: tauri::AppHandle) -> Result<String, String> {
    let url = "https://rocopvp.tzrain.wiki/api/popular/teams";
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;

    // Validate it's parseable JSON
    serde_json::from_str::<serde_json::Value>(&text)
        .map_err(|e| format!("响应不是有效 JSON: {e}"))?;

    let path = cache_path(&app);
    fs::write(&path, &text).map_err(|e| format!("写入缓存失败: {e}"))?;

    Ok(text)
}

#[tauri::command]
async fn get_cached_teams(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = cache_path(&app);
    if path.exists() {
        fs::read_to_string(&path)
            .map(Some)
            .map_err(|e| format!("读取缓存失败: {e}"))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn check_update() -> Result<String, String> {
    let current = env!("CARGO_PKG_VERSION");
    let url = "https://api.github.com/repos/roco-pvp/roco-pvp-app/releases/latest";
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("检查更新失败: {e}"))?;
    if resp.status().is_success() {
        let text = resp.text().await.map_err(|e| format!("读取失败: {e}"))?;
        // Parse JSON for tag_name
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
            let latest = json["tag_name"].as_str().unwrap_or("unknown");
            if latest != current {
                Ok(format!("发现新版本: {latest} (当前: {current})\n请前往发布页下载"))
            } else {
                Ok(format!("已是最新版本 ({current})"))
            }
        } else {
            Ok(format!("无法解析版本信息 (当前: {current})"))
        }
    } else {
        Ok(format!("无法连接更新服务器 (当前版本: {current})"))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            fetch_popular_teams,
            get_cached_teams,
            check_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
