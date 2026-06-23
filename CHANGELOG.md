# Changelog

本專案的重要變更記錄於此。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)。
外掛 Release 版本採 `major.minor` + CI run 編號當 patch（見 README）。

把要寫進下一次 Release 的條目放在 `## [Unreleased]` 底下；CI 會把這一段帶進 GitHub Release 說明。

## [Unreleased]
### Changed
- **presenter 身分改用 Cloudflare Access**（取代 `PRESENT_KEY`）。外掛用 `chrome.identity.launchWebAuthFlow` 登入 `/present`，Worker 把 Access JWT 轉回外掛；WebSocket 帶 `cf_token`，Worker 以 JWKS 驗簽章 + `aud` + `exp` 才給 presenter。再也沒有要手動管理的共用密碼。
- 重做外掛 UI（popup / 工具列面板 / 設定頁）：深色卡片風、CF Access 登入狀態指示；設定頁只剩 Cloudflare 網址。
- `wrangler.toml` 新增 `[vars]` `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`（公開設定）。

### Added
- `Makefile`：`build`（打包外掛 zip）、`load`（乾淨 Chrome 載入未封裝外掛）、`dev` / `deploy` / `gate` / `clean` 等快捷。
- 社群健康檔：PR 範本、issue 範本（bug/功能）、CONTRIBUTING、CODE_OF_CONDUCT、SECURITY。
- README 徽章與架構圖（docs/architecture.svg）。
- Dependabot（npm + github-actions）與 .editorconfig。

### Removed
- `PRESENT_KEY` 機密與外掛的「控制密碼」欄位；`package.json` 的 `secret` script；舊的 `/present` 純網頁主控端（已改為 Access 登入橋接）。

## [1.0.0] - 2026-06-23
### Added
- Cloudflare Worker + Durable Object relay，含 PIN 驗證與 live/offline 狀態。
- Chrome 外掛（MV3）：讀 Google 原生放映的當前頁並 relay。
- Viewer 頁：PIN 進場、跟播 / 自由翻、全螢幕、無閃爍換頁。
- GitHub Actions：Worker 自動部署、外掛自動定版發 Release。
