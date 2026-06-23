// 在 Google Slides「編輯器」工具列注入一顆「Live」藥丸鈕（放在「投影播放」左側）。
// 點開展開就地小面板：填 embed / 房間 / PIN（＋可展開的 CF 網址、控制密碼設定），
// 直接開始 / 結束直播。直播中鈕變紅並顯示「● Live · PIN」。
// 放映時的翻頁回報仍由 content.js 負責；本檔只在編輯頁工作。

(() => {
  // 放映頁（/present）不注入——那裡沒有編輯器工具列。
  const inPresent = () => location.pathname.endsWith("/present") || /\/present(\/|$|\?)/.test(location.href);
  if (inPresent()) return;

  const genPin = () => String(Math.floor(1000 + Math.random() * 9000));
  const $ = sel => document.querySelector(sel);

  // ── 樣式（用 lgs- 前綴，避免和 Slides 衝突）────────────────────────────
  const style = document.createElement("style");
  style.id = "lgs-style";
  style.textContent = `
    .lgs-pill{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;margin-right:6px;
      border:1px solid #c4c7c5;border-radius:16px;background:#fff;color:#3c4043;cursor:pointer;
      font:500 13px/1 'Google Sans',system-ui,sans-serif;white-space:nowrap;user-select:none}
    .lgs-pill:hover{background:#f1f3f4}
    .lgs-pill.live{border-color:#ea4335;color:#d93025;background:#fce8e6}
    .lgs-dot{width:8px;height:8px;border-radius:50%;background:#9aa0a6}
    .lgs-pill.live .lgs-dot{background:#ea4335}
    .lgs-caret{font-size:10px;opacity:.6}
    .lgs-panel{position:fixed;z-index:2147483647;width:300px;background:#fff;color:#202124;
      border:1px solid #dadce0;border-radius:12px;box-shadow:0 6px 24px #0003;
      padding:14px;font:13px/1.4 system-ui,sans-serif;box-sizing:border-box}
    .lgs-panel[hidden]{display:none}
    .lgs-panel label{display:block;margin:10px 0 4px;font-size:12px;color:#5f6368}
    .lgs-panel input,.lgs-panel textarea{width:100%;box-sizing:border-box;padding:8px;font-size:13px;
      border:1px solid #dadce0;border-radius:8px;font-family:inherit}
    .lgs-panel textarea{height:48px;resize:vertical}
    .lgs-row{display:flex;gap:8px;align-items:center}.lgs-row input{flex:1}
    .lgs-panel button{padding:9px 14px;border:0;border-radius:8px;font-size:13px;cursor:pointer}
    .lgs-start{background:#1a73e8;color:#fff;flex:1}.lgs-stop{background:#d93025;color:#fff;flex:1}
    .lgs-gen{background:#f1f3f4;color:#3c4043}
    .lgs-warn{color:#d93025;font-size:12px;margin:2px 0 0;min-height:0}
    .lgs-warn:empty{display:none}
    .lgs-status{margin-top:10px;font-size:12px;background:#f1f3f4;border-radius:8px;padding:8px;color:#3c4043}
    .lgs-pin{font-size:18px;font-weight:600;letter-spacing:3px}
    .lgs-adv-toggle{margin-top:12px;font-size:12px;color:#1a73e8;cursor:pointer;user-select:none}
    .lgs-adv[hidden]{display:none}
    .lgs-hint{color:#80868b;font-size:11px;margin-top:6px}
  `;

  // ── 建立藥丸鈕 ──────────────────────────────────────────────────────
  const pill = document.createElement("div");
  pill.className = "lgs-pill";
  pill.id = "lgs-pill";
  pill.innerHTML = `<span class="lgs-dot"></span><span class="lgs-label">Live</span><span class="lgs-caret">▾</span>`;
  const label = () => pill.querySelector(".lgs-label");

  // ── 建立面板（掛在 body，fixed 定位）──────────────────────────────────
  const panel = document.createElement("div");
  panel.className = "lgs-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="lgs-warn" id="lgs-warn"></div>
    <label>這份簡報的 embed 網址（發布到網路 → 嵌入）</label>
    <textarea id="lgs-embed" placeholder="https://docs.google.com/presentation/d/e/XXXX/pubembed?..."></textarea>
    <div class="lgs-row">
      <div style="flex:1"><label>房間 room</label><input id="lgs-room" placeholder="talk"></div>
      <div style="flex:1"><label>PIN</label>
        <div class="lgs-row"><input id="lgs-pin" maxlength="8"><button class="lgs-gen" id="lgs-gen">產生</button></div>
      </div>
    </div>
    <div class="lgs-row" style="margin-top:14px">
      <button class="lgs-start" id="lgs-start">開始直播</button>
      <button class="lgs-stop" id="lgs-stop" style="display:none">結束</button>
    </div>
    <div class="lgs-status" id="lgs-status"></div>
    <div class="lgs-adv-toggle" id="lgs-adv-toggle">⚙ 設定 CF 網址 / 控制密碼</div>
    <div class="lgs-adv" id="lgs-adv" hidden>
      <label>Cloudflare 網址（你的 Worker，含 https://）</label>
      <input id="lgs-cf" placeholder="https://live.hsiehting.com">
      <label>控制密碼（Worker 的 PRESENT_KEY）</label>
      <input id="lgs-key" type="password" placeholder="presenter key">
      <div class="lgs-hint">這兩個值只填一次，之後每份簡報共用。</div>
    </div>`;

  const el = id => panel.querySelector("#lgs-" + id);

  // ── 狀態載入 / 寫回 ──────────────────────────────────────────────────
  async function load() {
    const sync = await chrome.storage.sync.get(["cfUrl", "key"]);
    const local = await chrome.storage.local.get(["deckCfg", "active"]);
    const c = local.deckCfg || {};
    el("embed").value = c.embedBase || "";
    el("room").value = c.room || "talk";
    el("pin").value = c.pin || genPin();
    el("cf").value = sync.cfUrl || "";
    el("key").value = sync.key || "";
    if (!sync.cfUrl || !sync.key) el("adv").hidden = false;
    setActiveUI(!!local.active, c.pin);
    refreshStatus();
  }

  function setActiveUI(active, pin) {
    el("start").style.display = active ? "none" : "block";
    el("stop").style.display = active ? "block" : "none";
    ["embed", "room", "pin", "gen", "cf", "key"].forEach(id => (el(id).disabled = active));
    pill.classList.toggle("live", active);
    label().textContent = active ? "Live · " + (pin || "") : "Live";
  }

  async function refreshStatus() {
    const local = await chrome.storage.local.get(["deckCfg", "active"]);
    const sync = await chrome.storage.sync.get(["cfUrl"]);
    const cfg = local.deckCfg || {};
    let connected = false;
    try { connected = (await chrome.runtime.sendMessage({ type: "status?" }))?.connected; } catch {}
    if (local.active) {
      const view = (sync.cfUrl || "").replace(/\/$/, "") + "/view?room=" + (cfg.room || "");
      el("status").innerHTML =
        (connected ? "● 連線中" : "○ 連線中斷，重試中…") +
        '<br>PIN：<span class="lgs-pin">' + (cfg.pin || "") + "</span>" +
        '<br><small>觀眾開：' + view + "</small>" +
        "<br><small>記得讓 Google 進入『放映』模式</small>";
    } else {
      el("status").innerHTML = "<small>填好上面、按「開始直播」，再進入放映。</small>";
    }
  }

  // ── 事件 ────────────────────────────────────────────────────────────
  function positionPanel() {
    const r = pill.getBoundingClientRect();
    panel.style.top = r.bottom + 6 + "px";
    // 靠右對齊藥丸鈕，但不超出視窗
    let left = r.right - 300;
    left = Math.max(8, Math.min(left, window.innerWidth - 308));
    panel.style.left = left + "px";
  }
  function togglePanel(show) {
    const willShow = show ?? panel.hidden;
    if (willShow) { positionPanel(); panel.hidden = false; load(); }
    else panel.hidden = true;
  }
  pill.addEventListener("click", e => { e.stopPropagation(); togglePanel(); });
  document.addEventListener("click", e => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== pill && !pill.contains(e.target)) panel.hidden = true;
  });
  window.addEventListener("resize", () => { if (!panel.hidden) positionPanel(); });

  el("gen").addEventListener("click", () => (el("pin").value = genPin()));
  el("adv-toggle").addEventListener("click", () => (el("adv").hidden = !el("adv").hidden));

  el("start").addEventListener("click", async () => {
    const cfUrl = el("cf").value.trim(), key = el("key").value.trim();
    const embedBase = el("embed").value.trim();
    const room = el("room").value.trim() || "talk", pin = el("pin").value.trim();
    const warn = el("warn");
    if (!cfUrl || !key) { el("adv").hidden = false; warn.textContent = "請先填 CF 網址與控制密碼。"; return; }
    if (!embedBase) { warn.textContent = "請貼 embed 網址。"; return; }
    warn.textContent = "";
    await chrome.storage.sync.set({ cfUrl, key });
    const deckCfg = { cfUrl, key, embedBase, room, pin };
    await chrome.storage.local.set({ deckCfg, active: true });
    await chrome.runtime.sendMessage({ type: "start", cfg: deckCfg });
    setActiveUI(true, pin);
    setTimeout(refreshStatus, 400);
  });

  el("stop").addEventListener("click", async () => {
    await chrome.storage.local.set({ active: false });
    await chrome.runtime.sendMessage({ type: "stop" });
    setActiveUI(false);
    refreshStatus();
  });

  // background 廣播連線狀態變化 → 更新面板/藥丸
  chrome.runtime.onMessage.addListener(m => { if (m.type === "status") refreshStatus(); });

  // ── 把藥丸鈕插進工具列（投影播放鈕左側），並在 Slides 重繪時補回 ──────────
  // 這幾個 id 是 Slides 跨語系穩定的內部 id；逐一嘗試。
  const ANCHORS = [
    "#punch-start-presentation-container",
    "#punch-start-presentation-left",
    "#punch-start-presentation-menu-button",
  ];
  function findAnchor() {
    for (const sel of ANCHORS) { const e = $(sel); if (e) return e; }
    return null;
  }
  function mount() {
    if (inPresent()) return;
    if (!document.getElementById("lgs-style")) document.head.appendChild(style);
    if (!panel.isConnected) document.body.appendChild(panel);
    if (pill.isConnected) return;
    const anchor = findAnchor();
    if (!anchor) return;
    // 插在投影播放容器（或其最外層按鈕群組）之前
    const target = anchor.closest("#punch-start-presentation-container") || anchor;
    target.parentElement.insertBefore(pill, target);
  }

  // 工具列是動態渲染的：先輪詢直到出現，之後用 observer 確保被移除時補回。
  let tries = 0;
  const timer = setInterval(() => {
    mount();
    if (pill.isConnected || ++tries > 40) clearInterval(timer); // 最多試 ~20s
  }, 500);
  new MutationObserver(() => { if (!pill.isConnected) mount(); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();
