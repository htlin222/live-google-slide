// 在 Google Slides「編輯器」工具列注入一顆「Live」藥丸鈕（放在「投影播放」左側）。
// 點開展開就地小面板：填 embed / 房間 / PIN（＋可展開的 CF 網址設定），直接開始 / 結束直播。
// presenter 身分由 CF Access 把關（不再有「控制密碼」）；第一次開直播會跳出登入。
// 直播中鈕變紅並顯示「● Live · PIN」。翻頁回報仍由 content.js 負責；本檔只在編輯頁工作。
// 注意：Slides 啟用 Trusted Types，全程用 DOM API 建構、不碰 innerHTML。

(() => {
  // 放映頁（/present）不注入——那裡沒有編輯器工具列。
  const inPresent = () => location.pathname.endsWith("/present") || /\/present(\/|$|\?)/.test(location.href);
  if (inPresent()) return;
  if (document.getElementById("lgs-pill") || document.getElementById("lgs-style")) return; // 防重複注入

  const genPin = () => String(Math.floor(1000 + Math.random() * 9000));

  // 小型 DOM 建構器（避開 innerHTML / Trusted Types）
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const k in (props || {})) {
      const v = props[k];
      if (k === "class") e.className = v;
      else if (k === "style") e.style.cssText = v;
      else if (k in e) e[k] = v;
      else e.setAttribute(k, v);
    }
    for (const c of kids) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(c)); }
    return e;
  }
  function setText(node, ...kids) { node.replaceChildren(...kids.map(k => (k && k.nodeType) ? k : document.createTextNode(k))); }

  // ── 樣式（textContent 非 Trusted Types sink，安全）─────────────────────
  const style = h("style", { id: "lgs-style", textContent: `
    .lgs-pill{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;margin-right:6px;
      border:1px solid #c4c7c5;border-radius:16px;background:#fff;color:#3c4043;cursor:pointer;
      font:500 13px/1 'Google Sans',system-ui,sans-serif;white-space:nowrap;user-select:none;vertical-align:middle}
    .lgs-pill:hover{background:#f1f3f4}
    .lgs-pill.live{border-color:#ea4335;color:#d93025;background:#fce8e6}
    .lgs-dot{width:8px;height:8px;border-radius:50%;background:#9aa0a6;flex:none}
    .lgs-pill.live .lgs-dot{background:#ea4335}
    .lgs-caret{font-size:10px;opacity:.6}
    .lgs-panel{position:fixed;z-index:2147483647;width:308px;background:#fff;color:#202124;
      border:1px solid #dadce0;border-radius:12px;box-shadow:0 8px 28px #0003;
      padding:14px;font:13px/1.45 system-ui,sans-serif;box-sizing:border-box}
    .lgs-panel[hidden]{display:none}
    .lgs-panel label{display:block;margin:11px 0 4px;font-size:12px;color:#5f6368}
    .lgs-panel input,.lgs-panel textarea{width:100%;box-sizing:border-box;padding:8px;font-size:13px;
      border:1px solid #dadce0;border-radius:8px;font-family:inherit}
    .lgs-panel textarea{height:48px;resize:vertical}
    .lgs-row{display:flex;gap:8px;align-items:center}.lgs-row input{flex:1}
    .lgs-panel button{padding:9px 14px;border:0;border-radius:8px;font-size:13px;cursor:pointer}
    .lgs-start{background:#1a73e8;color:#fff;flex:1}.lgs-stop{background:#d93025;color:#fff;flex:1}
    .lgs-gen{background:#f1f3f4;color:#3c4043}
    .lgs-auth{display:flex;align-items:center;gap:8px;background:#f1f3f4;border-radius:8px;padding:8px 10px;font-size:12px;color:#5f6368}
    .lgs-auth .ico{width:8px;height:8px;border-radius:50%;background:#9aa0a6;flex:none}
    .lgs-auth.in .ico{background:#1e8e3e}
    .lgs-auth button{margin-left:auto;padding:5px 12px;background:#1a73e8;color:#fff;font-size:12px}
    .lgs-auth.in button{display:none}
    .lgs-warn{color:#d93025;font-size:12px;margin:8px 0 0}.lgs-warn:empty{display:none}
    .lgs-status{margin-top:10px;font-size:12px;background:#f1f3f4;border-radius:8px;padding:8px;color:#3c4043}
    .lgs-pin{font-size:18px;font-weight:600;letter-spacing:3px}
    .lgs-adv-toggle{margin-top:12px;font-size:12px;color:#1a73e8;cursor:pointer;user-select:none}
    .lgs-adv[hidden]{display:none}
    .lgs-hint{color:#80868b;font-size:11px;margin-top:6px}
  ` });

  // ── 藥丸鈕 ──────────────────────────────────────────────────────────
  const dot = h("span", { class: "lgs-dot" });
  const labelEl = h("span", { class: "lgs-label", textContent: "Live" });
  const pill = h("div", { class: "lgs-pill", id: "lgs-pill" },
    dot, labelEl, h("span", { class: "lgs-caret", textContent: "▾" }));

  // ── 面板欄位 ────────────────────────────────────────────────────────
  const authBox = h("div", { class: "lgs-auth" });
  const authIco = h("span", { class: "ico" });
  const authWho = h("span", { textContent: "未登入 CF Access" });
  const signinB = h("button", { textContent: "登入" });
  authBox.append(authIco, authWho, signinB);

  const warn = h("div", { class: "lgs-warn" });
  const embedI = h("textarea", { id: "lgs-embed", placeholder: "https://docs.google.com/presentation/d/e/XXXX/pubembed?..." });
  const roomI = h("input", { id: "lgs-room", placeholder: "talk" });
  const pinI = h("input", { id: "lgs-pin", maxlength: "8" });
  const genB = h("button", { class: "lgs-gen", textContent: "產生" });
  const startB = h("button", { class: "lgs-start", textContent: "開始直播" });
  const stopB = h("button", { class: "lgs-stop", style: "display:none", textContent: "結束" });
  const statusBox = h("div", { class: "lgs-status" });
  const cfI = h("input", { id: "lgs-cf", placeholder: "https://live.hsiehting.com" });
  const adv = h("div", { class: "lgs-adv", hidden: true },
    h("label", { textContent: "Cloudflare 網址（你的 Worker，含 https://）" }), cfI,
    h("div", { class: "lgs-hint", textContent: "只填一次，之後每份簡報共用。presenter 身分由 CF Access 把關。" }));
  const advToggle = h("div", { class: "lgs-adv-toggle", textContent: "⚙ 設定 CF 網址" });

  const panel = h("div", { class: "lgs-panel", hidden: true },
    authBox, warn,
    h("label", { textContent: "這份簡報的 embed 網址（發布到網路 → 嵌入）" }), embedI,
    h("div", { class: "lgs-row", style: "margin-top:4px" },
      h("div", { style: "flex:1" }, h("label", { textContent: "房間 room" }), roomI),
      h("div", { style: "flex:1" }, h("label", { textContent: "PIN" }),
        h("div", { class: "lgs-row" }, pinI, genB))),
    h("div", { class: "lgs-row", style: "margin-top:14px" }, startB, stopB),
    statusBox, advToggle, adv);

  // ── 狀態載入 / 寫回 ──────────────────────────────────────────────────
  async function load() {
    const sync = await chrome.storage.sync.get(["cfUrl"]);
    const local = await chrome.storage.local.get(["deckCfg", "active"]);
    const c = local.deckCfg || {};
    embedI.value = c.embedBase || "";
    roomI.value = c.room || "talk";
    pinI.value = c.pin || genPin();
    cfI.value = sync.cfUrl || "";
    if (!sync.cfUrl) adv.hidden = false;
    setActiveUI(!!local.active, c.pin);
    refreshAuth();
    refreshStatus();
  }

  async function refreshAuth() {
    let signedIn = false;
    try { signedIn = (await chrome.runtime.sendMessage({ type: "authState" }))?.signedIn; } catch {}
    authBox.classList.toggle("in", !!signedIn);
    authWho.textContent = signedIn ? "已登入 CF Access" : "未登入 CF Access";
  }

  function setActiveUI(active, pin) {
    startB.style.display = active ? "none" : "block";
    stopB.style.display = active ? "block" : "none";
    [embedI, roomI, pinI, genB, cfI, signinB].forEach(n => (n.disabled = active));
    pill.classList.toggle("live", active);
    labelEl.textContent = active ? "Live · " + (pin || "") : "Live";
  }

  async function refreshStatus() {
    const local = await chrome.storage.local.get(["deckCfg", "active"]);
    const sync = await chrome.storage.sync.get(["cfUrl"]);
    const cfg = local.deckCfg || {};
    let connected = false;
    try { connected = (await chrome.runtime.sendMessage({ type: "status?" }))?.connected; } catch {}
    if (local.active) {
      const view = (sync.cfUrl || "").replace(/\/$/, "") + "/view?room=" + (cfg.room || "");
      setText(statusBox,
        connected ? "● 直播中" : "○ 連線中斷，重試中…", h("br"),
        "PIN：", h("span", { class: "lgs-pin", textContent: cfg.pin || "—" }), h("br"),
        h("small", { textContent: "觀眾開：" + view }), h("br"),
        h("small", { textContent: "記得讓 Google 進入『放映』模式" }));
    } else {
      setText(statusBox, h("small", { textContent: "填好上面、按「開始直播」（第一次會跳 CF Access 登入），再進入放映。" }));
    }
  }

  // ── 定位 / 開關面板 ──────────────────────────────────────────────────
  function positionPanel() {
    const r = pill.getBoundingClientRect();
    panel.style.top = r.bottom + 6 + "px";
    panel.style.left = Math.max(8, Math.min(r.right - 308, window.innerWidth - 316)) + "px";
  }
  function togglePanel(show) {
    const willShow = show ?? panel.hidden;
    if (willShow) { positionPanel(); panel.hidden = false; load(); }
    else panel.hidden = true;
  }
  pill.addEventListener("click", e => { e.stopPropagation(); togglePanel(); });
  document.addEventListener("click", e => {
    if (!panel.hidden && !panel.contains(e.target) && !pill.contains(e.target)) panel.hidden = true;
  });
  window.addEventListener("resize", () => { if (!panel.hidden) positionPanel(); });

  genB.addEventListener("click", () => (pinI.value = genPin()));
  advToggle.addEventListener("click", () => (adv.hidden = !adv.hidden));

  signinB.addEventListener("click", async () => {
    const cfUrl = cfI.value.trim();
    if (!cfUrl) { adv.hidden = false; warn.textContent = "請先填 CF 網址。"; return; }
    await chrome.storage.sync.set({ cfUrl });
    authWho.textContent = "登入中…";
    try { await chrome.runtime.sendMessage({ type: "signin", cfUrl }); } catch {}
    refreshAuth();
  });

  startB.addEventListener("click", async () => {
    const cfUrl = cfI.value.trim();
    const embedBase = embedI.value.trim();
    const room = roomI.value.trim() || "talk", pin = pinI.value.trim();
    if (!cfUrl) { adv.hidden = false; warn.textContent = "請先填 CF 網址。"; return; }
    if (!embedBase) { warn.textContent = "請貼 embed 網址。"; return; }
    warn.textContent = "";
    await chrome.storage.sync.set({ cfUrl });
    const deckCfg = { cfUrl, embedBase, room, pin };
    await chrome.storage.local.set({ deckCfg, active: true });
    await chrome.runtime.sendMessage({ type: "start", cfg: deckCfg });
    setActiveUI(true, pin);
    setTimeout(() => { refreshAuth(); refreshStatus(); }, 600);
  });

  stopB.addEventListener("click", async () => {
    await chrome.storage.local.set({ active: false });
    await chrome.runtime.sendMessage({ type: "stop" });
    setActiveUI(false);
    refreshStatus();
  });

  chrome.runtime.onMessage.addListener(m => { if (m.type === "status") { refreshStatus(); refreshAuth(); } });

  // ── 插進工具列（投影播放鈕左側），Slides 重繪時補回 ────────────────────
  const ANCHORS = ["#punch-start-presentation-container", "#punch-start-presentation-left", "#punch-start-presentation-menu-button"];
  function findAnchor() { for (const sel of ANCHORS) { const e = document.querySelector(sel); if (e) return e; } return null; }
  function mount() {
    if (inPresent()) return;
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
    if (!panel.isConnected) document.body.appendChild(panel);
    if (pill.isConnected) return;
    const anchor = findAnchor();
    if (!anchor) return;
    const target = anchor.closest("#punch-start-presentation-container") || anchor;
    target.parentElement.insertBefore(pill, target);
  }

  let tries = 0;
  const timer = setInterval(() => { mount(); if (pill.isConnected || ++tries > 40) clearInterval(timer); }, 500);
  new MutationObserver(() => { if (!pill.isConnected) mount(); }).observe(document.documentElement, { childList: true, subtree: true });
  mount();
})();
