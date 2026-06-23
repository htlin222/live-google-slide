# 安全政策

## 回報漏洞

請**不要**開公開 issue。請用 GitHub 的私下回報：
`Security → Report a vulnerability`（Security Advisories），或寄信至 **<your-email@example.com>**。
我們會盡快回覆並協調修補與揭露時程。

## 設計上的已知限制（非漏洞）

本專案的威脅模型有一條刻意的天花板，使用前請理解：

- Viewer 用 Google「發布到網路」的 embed 顯示，**該簡報本身是公開的**。
- `PIN` 擋的是**進場**，擋不了**已進場的人**：任何輸對 PIN 的觀眾，其瀏覽器仍會載入 Google 的 public deck，可從開發者工具取得原始網址、之後繞過 PIN 重看或轉發。
- 因此本專案**不**宣稱能讓 deck 內容對已驗證者保密。若需要「deck 全程私有、無任何可繞網址」，必須改採 deck 私有 + Slides API `pages.getThumbnail` 由伺服器出圖的模式（本 repo 未含）。

## 良好實務

- `PRESENT_KEY` 與 Cloudflare token 一律用 secret 管理，切勿提交。
- 每場簡報使用不同的 PIN。
- 敏感簡報請勿使用「發布到網路」模式。
