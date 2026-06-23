# 參與貢獻

歡迎 PR 與 issue！這是一個小而完整的專案，請保持簡單。

## 開發環境

```bash
make install                     # = pnpm install
make dev                         # 本機跑 Worker（wrangler dev）；localhost 會自動放行 presenter
```

presenter 身分由 CF Access 把關，本機 dev 無需設定。外掛部分：`make load` 直接開乾淨 Chrome 載入未封裝外掛，或 `chrome://extensions` → 開發人員模式 →「載入未封裝項目」→ 選 `extension/`。改完按重新整理即可。

## 送 PR 前

- `npx wrangler deploy --dry-run` 要能通過（CI 也會跑這個）。
- 動到外掛就在 Chrome 實測過一輪放映 → 觀眾跟播。
- 使用者可感知的變更，請在 `CHANGELOG.md` 的 `## [Unreleased]` 補一行。
- 別把任何 secret（Cloudflare token 等）寫進程式或提交。（presenter 已改用 CF Access，無共用密碼。）

## 版本與發布

外掛版本由 CI 自動產生（`manifest.json` 的 major.minor + run 編號）。要升 major/minor 就改 `extension/manifest.json` 前兩段。merge 進 `main` 後，CI 會自動打包並建立 Release。

## 程式風格

沒有強制 linter；請沿用現有檔案的風格（2 空白縮排、見 `.editorconfig`）。保持相依套件最少。

## 行為準則

參與本專案即表示同意遵守 [Code of Conduct](./CODE_OF_CONDUCT.md)。
