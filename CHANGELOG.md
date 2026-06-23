# Changelog

本專案的重要變更記錄於此。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)。
外掛 Release 版本採 `major.minor` + CI run 編號當 patch（見 README）。

把要寫進下一次 Release 的條目放在 `## [Unreleased]` 底下；CI 會把這一段帶進 GitHub Release 說明。

## [Unreleased]

## [1.0.0] - 2026-06-23
### Added
- Cloudflare Worker + Durable Object relay，含 PIN 驗證與 live/offline 狀態。
- Chrome 外掛（MV3）：讀 Google 原生放映的當前頁並 relay。
- Viewer 頁：PIN 進場、跟播 / 自由翻、全螢幕、無閃爍換頁。
- GitHub Actions：Worker 自動部署、外掛自動定版發 Release。
