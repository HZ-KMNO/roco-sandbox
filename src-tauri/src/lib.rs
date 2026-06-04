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
    let url = "https://api.github.com/repos/HZ-KMNO/roco-sandbox/releases/latest";
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .header("User-Agent", "roco-sandbox")
        .send()
        .await
        .map_err(|e| format!("检查更新失败: {e}"))?;
    if resp.status().is_success() {
        let text = resp.text().await.map_err(|e| format!("读取失败: {e}"))?;
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
            let tag = json["tag_name"].as_str().unwrap_or("unknown");
            let latest = tag.strip_prefix('v').unwrap_or(tag);
            if latest != current && latest != "unknown" {
                // 尝试找到 .exe / .msi 安装包下载链接
                let download_url = json["assets"]
                    .as_array()
                    .and_then(|assets| {
                        assets.iter().find_map(|a| {
                            let name = a["name"].as_str().unwrap_or("");
                            if name.ends_with(".exe") || name.ends_with(".msi") {
                                a["browser_download_url"].as_str().map(|s| s.to_string())
                            } else {
                                None
                            }
                        })
                    })
                    .unwrap_or_else(|| {
                        json["html_url"].as_str().unwrap_or("https://github.com/HZ-KMNO/roco-sandbox/releases").to_string()
                    });
                Ok(format!("发现新版本: v{latest} (当前: v{current})\n下载地址: {download_url}"))
            } else {
                Ok(format!("已是最新版本 (v{current})"))
            }
        } else {
            Ok(format!("无法解析版本信息 (当前: v{current})"))
        }
    } else {
        Ok(format!("无法连接更新服务器 (当前版本: v{current})"))
    }
}

#[tauri::command]
async fn download_update(url: String) -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join("RocoSandbox_Setup.exe");
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", "roco-sandbox")
        .send()
        .await
        .map_err(|e| format!("下载失败: {e}"))?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取下载内容失败: {e}"))?;
    fs::write(&file_path, &bytes).map_err(|e| format!("保存文件失败: {e}"))?;
    // 启动安装程序（覆盖安装，保留用户数据）
    std::process::Command::new(&file_path)
        .spawn()
        .map_err(|e| format!("启动安装程序失败: {e}"))?;
    Ok("安装程序已启动，请按照提示完成安装。此窗口可以关闭。".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            fetch_popular_teams,
            get_cached_teams,
            check_update,
            download_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
