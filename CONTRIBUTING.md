# 參與貢獻

歡迎 PR 與 issue！這是一個小而完整的專案，請保持簡單。

## 開發環境

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入 PRESENT_KEY，不要 commit
npm run dev                      # 本機跑 Worker（wrangler dev）
```

外掛部分：`chrome://extensions` → 開發人員模式 →「載入未封裝項目」→ 選 `extension/`。改完按重新整理即可。

## 送 PR 前

- `npx wrangler deploy --dry-run` 要能通過（CI 也會跑這個）。
- 動到外掛就在 Chrome 實測過一輪放映 → 觀眾跟播。
- 使用者可感知的變更，請在 `CHANGELOG.md` 的 `## [Unreleased]` 補一行。
- 別把任何 secret（`PRESENT_KEY`、Cloudflare token）寫進程式或提交。

## 版本與發布

外掛版本由 CI 自動產生（`manifest.json` 的 major.minor + run 編號）。要升 major/minor 就改 `extension/manifest.json` 前兩段。merge 進 `main` 後，CI 會自動打包並建立 Release。

## 程式風格

沒有強制 linter；請沿用現有檔案的風格（2 空白縮排、見 `.editorconfig`）。保持相依套件最少。

## 行為準則

參與本專案即表示同意遵守 [Code of Conduct](./CODE_OF_CONDUCT.md)。
