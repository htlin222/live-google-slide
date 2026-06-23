// Background service worker：唯一持有對 Cloudflare 的 WebSocket。
// 不在 content script 開 WS，以避開 Google 頁面的 CSP 限制。

let ws = null;
let cfg = null;          // { cfUrl, key, embedBase, room, pin }
let lastSlideId = null;
let retry = 0;

function wsUrl(cfUrl, room, key) {
  const base = cfUrl.replace(/^http/, "ws").replace(/\/$/, "");
  return base + "/ws?role=presenter&room=" + encodeURIComponent(room) + "&key=" + encodeURIComponent(key);
}

function broadcastStatus() {
  const connected = !!ws && ws.readyState === 1;
  chrome.runtime.sendMessage({ type: "status", connected }).catch(() => {});
}

function connect() {
  if (!cfg) return;
  try { if (ws) ws.close(); } catch {}
  ws = new WebSocket(wsUrl(cfg.cfUrl, cfg.room, cfg.key));

  ws.onopen = () => {
    retry = 0;
    ws.send(JSON.stringify({ type: "init", pin: cfg.pin, embedBase: cfg.embedBase, slideIds: [] }));
    if (lastSlideId) ws.send(JSON.stringify({ type: "slide", slideId: lastSlideId }));
    broadcastStatus();
  };
  ws.onclose = () => { ws = null; broadcastStatus(); if (cfg) setTimeout(connect, Math.min(1500 * (++retry), 8000)); };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

function sendSlide(id) {
  lastSlideId = id;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "slide", slideId: id }));
}

async function resume() {
  const { deckCfg, active } = await chrome.storage.local.get(["deckCfg", "active"]);
  if (active && deckCfg) { cfg = deckCfg; if (!ws) connect(); }
}

function stop() {
  cfg = null; lastSlideId = null;
  try { if (ws) ws.close(); } catch {}
  ws = null;
  broadcastStatus();
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  switch (msg.type) {
    case "start": cfg = msg.cfg; lastSlideId = null; connect(); break;
    case "stop": stop(); break;
    case "slide": sendSlide(msg.slideId); break;
    case "resume": resume(); break;
    case "hb": /* keepalive，喚醒 SW 即可 */ break;
    case "status?": reply({ connected: !!ws && ws.readyState === 1 }); return true;
  }
});

// SW 被喚醒時，若先前是 active 狀態就自動接回去
chrome.runtime.onStartup.addListener(resume);
resume();
