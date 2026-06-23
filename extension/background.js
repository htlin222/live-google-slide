// Background service worker：唯一持有對 Cloudflare 的 WebSocket。
// 不在 content script 開 WS，以避開 Google 頁面的 CSP 限制。
//
// presenter 身分改用 CF Access：靠 chrome.identity.launchWebAuthFlow 開
// <cfUrl>/present 登入（Google/email，一次），Worker 把 Access JWT 以 #token=
// 轉回外掛；WS 帶 ?cf_token=<JWT> 連線，Worker 端驗 JWT 才給 presenter。

let ws = null;
let cfg = null;          // { cfUrl, embedBase, room, pin }
let lastSlideId = null;
let retry = 0;
let reauthing = false;
let connecting = false;

function wsUrl(cfUrl, room, token) {
  const base = cfUrl.replace(/^http/, "ws").replace(/\/$/, "");
  return base + "/ws?role=presenter&room=" + encodeURIComponent(room) + "&cf_token=" + encodeURIComponent(token);
}

function broadcastStatus() {
  const connected = !!ws && ws.readyState === 1;
  chrome.runtime.sendMessage({ type: "status", connected }).catch(() => {});
}

// ── CF Access 登入 ────────────────────────────────────────
function jwtExp(t) {
  try { return (JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp || 0) * 1000; }
  catch { return t === "dev" ? Date.now() + 3.6e6 : 0; }   // dev token 視為短期有效
}
function tokenAlive(t) { return !!t && jwtExp(t) > Date.now() + 30000; }

async function login(cfUrl, interactive) {
  if (!chrome.identity || !chrome.identity.launchWebAuthFlow) {
    console.error("[lgs] chrome.identity 不可用 — 外掛需重新載入以套用 identity 權限");
    await chrome.storage.local.set({ authErr: "identity 權限未生效，請重新載入外掛" });
    return null;
  }
  const redirect = chrome.identity.getRedirectURL();
  const authUrl = cfUrl.replace(/\/$/, "") + "/present?ext_redirect=" + encodeURIComponent(redirect);
  console.log("[lgs] login → launchWebAuthFlow", { authUrl, redirect, interactive });
  let out;
  try { out = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }); }
  catch (e) {                                              // 使用者取消 / 沒有現成 session / IdP 擋住
    console.warn("[lgs] launchWebAuthFlow 失敗", String(e));
    await chrome.storage.local.set({ authErr: String(e && e.message || e) });
    return null;
  }
  console.log("[lgs] launchWebAuthFlow 回傳", out);
  const m = out && out.match(/[#?]token=([^&]+)/);
  const token = m ? decodeURIComponent(m[1]) : null;
  if (token) { await chrome.storage.local.set({ cfToken: token, authErr: "" }); console.log("[lgs] 取得 token，長度", token.length); }
  else { await chrome.storage.local.set({ authErr: "回呼網址沒有 token：" + out }); console.warn("[lgs] 回呼沒有 token"); }
  return token;
}

// 先用快取的 token；過期或沒有就走登入（interactive 決定要不要彈視窗）
async function getToken(cfUrl, interactive) {
  const { cfToken } = await chrome.storage.local.get("cfToken");
  if (tokenAlive(cfToken)) return cfToken;
  return login(cfUrl, interactive);
}

// ── WebSocket ────────────────────────────────────────────
async function connect(interactive = false) {
  if (!cfg) return;
  if (connecting) return;                                          // 正在連，避免重複觸發造成 churn
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;  // 已連線/連線中
  connecting = true;
  let token;
  try { token = await getToken(cfg.cfUrl, interactive); } finally { connecting = false; }
  if (!token) { console.warn("[lgs] 沒有 token，暫不連線"); broadcastStatus(); return; }   // 沒登入就先不連
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;  // 取 token 期間已有人連上
  console.log("[lgs] 連線 WS", { room: cfg.room, url: cfg.cfUrl });
  ws = new WebSocket(wsUrl(cfg.cfUrl, cfg.room, token));

  ws.onopen = () => {
    retry = 0;
    ws.send(JSON.stringify({ type: "init", pin: cfg.pin, embedBase: cfg.embedBase, slideIds: [] }));
    if (lastSlideId) ws.send(JSON.stringify({ type: "slide", slideId: lastSlideId }));
    broadcastStatus();
  };
  ws.onmessage = async (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    // Worker 驗 token 失敗會把我們當 viewer → 清掉 token、彈視窗重新登入後重連
    if (m.type === "role") console.log("[lgs] 伺服器判定角色 =", m.role);
    if (m.type === "role" && m.role !== "presenter" && !reauthing) {
      reauthing = true;
      try { ws.close(); } catch {}
      await chrome.storage.local.remove("cfToken");
      const t = await login(cfg.cfUrl, true);
      reauthing = false;
      if (t) connect(false);
    }
  };
  ws.onclose = () => { ws = null; broadcastStatus(); if (cfg && !reauthing) setTimeout(() => connect(false), Math.min(1500 * (++retry), 8000)); };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

function sendSlide(id) {
  lastSlideId = id;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "slide", slideId: id }));
}

async function resume() {
  const { deckCfg, active } = await chrome.storage.local.get(["deckCfg", "active"]);
  if (active && deckCfg) { cfg = deckCfg; if (!ws) connect(false); }   // 自動重連只用快取 token，不彈視窗
}

function stop() {
  cfg = null; lastSlideId = null;
  try { if (ws) ws.close(); } catch {}
  ws = null;
  broadcastStatus();
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  switch (msg.type) {
    case "start": cfg = msg.cfg; lastSlideId = null; connect(true); break;   // 使用者按開始 → 允許彈登入視窗
    case "stop": stop(); break;
    case "slide": sendSlide(msg.slideId); break;
    case "resume": resume(); break;
    case "signin": login(msg.cfUrl, true).then(t => reply({ ok: !!t })); return true;
    case "authState": chrome.storage.local.get("cfToken").then(g => reply({ signedIn: tokenAlive(g.cfToken) })); return true;
    case "hb": /* keepalive，喚醒 SW 即可 */ break;
    case "status?": reply({ connected: !!ws && ws.readyState === 1 }); return true;
  }
});

// SW 被喚醒時，若先前是 active 狀態就自動接回去
chrome.runtime.onStartup.addListener(resume);
resume();
