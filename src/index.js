// slide-sync — Cloudflare Worker + Durable Object
// PIN 驗證版：viewer 要輸入正確 PIN，DO 才把 deck 網址＋當前頁發給它。
// presenter 連著才 live；deck 設定（embed 網址＋slide ids＋pin）由 presenter 帶進來。

export class Room {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  presenters() { return this.ctx.getWebSockets("presenter"); }
  viewers()    { return this.ctx.getWebSockets("viewer"); }
  async sha(s) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
  }
  att(ws) { try { return ws.deserializeAttachment() || {}; } catch { return {}; } }

  async fetch(request) {
    const url = new URL(request.url);
    const wantP = url.searchParams.get("role") === "presenter";
    // presenter 身分由 CF Access JWT 驗證（不再用 PRESENT_KEY）。
    // 本機 dev：在 .dev.vars 設 DEV_OPEN_PRESENTER=1 即可免 token 當 presenter（正式環境不會有這個 var）。
    const devOpen = this.env.DEV_OPEN_PRESENTER === "1";
    let role = "viewer";
    if (wantP) {
      if (devOpen) role = "presenter";
      else if (await verifyAccessJwt(url.searchParams.get("cf_token") || "", this.env.ACCESS_TEAM_DOMAIN, this.env.ACCESS_AUD)) role = "presenter";
      // 驗不過 → 仍當 viewer；extension 收到 role!=="presenter" 會清掉 token 重新登入
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [role]);
    try { server.send(JSON.stringify({ type: "role", role })); } catch {}

    if (role === "presenter") {
      await this.ctx.storage.setAlarm(Date.now() + 10000);   // 啟動 keepalive ping 迴圈，撐住 MV3 service worker
      // 等 presenter 送 init（帶 pin/deck）後再決定怎麼對待 viewer
    } else {
      server.serializeAttachment({ verified: false, tries: 0 });
      const deck = await this.ctx.storage.get("deck");
      const live = this.presenters().length > 0;
      if (live && deck && deck.pinHash)       try { server.send(JSON.stringify({ type: "need_pin" })); } catch {}
      else if (live && deck && !deck.pinHash) await this.sendReady(server, deck);   // 沒設 pin → 直接放行
      else                                    try { server.send(JSON.stringify({ type: "live", live: false })); } catch {}
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async sendReady(ws, deck) {
    try {
      ws.send(JSON.stringify({ type: "ready", embedBase: deck.embedBase, slideIds: deck.slideIds }));
      ws.send(JSON.stringify({ type: "live", live: this.presenters().length > 0 }));
      const cur = await this.ctx.storage.get("current");
      if (cur) ws.send(JSON.stringify({ type: "slide", ...cur }));
    } catch {}
  }

  async webSocketMessage(ws, message) {
    let d; try { d = JSON.parse(message); } catch { return; }
    const isP = this.ctx.getTags(ws).includes("presenter");

    // presenter 開講：設定 deck + pin，並通知在線 viewer
    if (isP && d.type === "init") {
      const deck = {
        pinHash: d.pin ? await this.sha(d.pin) : null,
        embedBase: String(d.embedBase || ""),
        slideIds: Array.isArray(d.slideIds) ? d.slideIds : [],
      };
      await this.ctx.storage.put("deck", deck);
      for (const v of this.viewers()) {
        if (this.att(v).verified) await this.sendReady(v, deck);
        else if (deck.pinHash) try { v.send(JSON.stringify({ type: "need_pin" })); } catch {}
        else await this.sendReady(v, deck);
      }
      return;
    }

    // presenter 翻頁：只發給已驗證的 viewer
    if (isP && d.type === "slide") {
      const cur = { slideId: String(d.slideId ?? ""), index: Number.isInteger(d.index) ? d.index : null, ts: Date.now() };
      await this.ctx.storage.put("current", cur);
      const msg = JSON.stringify({ type: "slide", ...cur });
      for (const v of this.viewers())    if (this.att(v).verified) { try { v.send(msg); } catch {} }
      for (const p of this.presenters()) if (p !== ws) { try { p.send(msg); } catch {} }
      return;
    }

    // viewer 送 PIN
    if (!isP && d.type === "pin") {
      const a = this.att(ws);
      if (a.verified) return;
      const deck = await this.ctx.storage.get("deck");
      if (!deck || !deck.pinHash) { try { ws.send(JSON.stringify({ type: "denied", reason: "not_live" })); } catch {} return; }
      a.tries = (a.tries || 0) + 1;
      if (await this.sha(d.pin) === deck.pinHash) {
        a.verified = true; ws.serializeAttachment(a);
        await this.sendReady(ws, deck);
      } else {
        ws.serializeAttachment(a);
        if (a.tries >= 5) { try { ws.send(JSON.stringify({ type: "denied", reason: "too_many" })); } catch {} try { ws.close(4003, "too many"); } catch {} }
        else try { ws.send(JSON.stringify({ type: "denied", reason: "wrong", left: 5 - a.tries })); } catch {}
      }
      return;
    }
  }

  async webSocketClose(ws, code) {
    const wasP = this.ctx.getTags(ws).includes("presenter");
    try { ws.close(code, "closing"); } catch {}
    if (wasP && this.presenters().filter(s => s !== ws).length === 0)
      await this.ctx.storage.setAlarm(Date.now() + 8000);
  }

  async alarm() {
    const ps = this.presenters();
    if (ps.length > 0) {
      // presenter 還在 → 每 10s 推一個 ping。外掛收到 WS 訊息會重置 MV3 service worker 的閒置計時器，避免被回收而斷線。
      for (const p of ps) { try { p.send(JSON.stringify({ type: "ping" })); } catch {} }
      await this.ctx.storage.setAlarm(Date.now() + 10000);
      return;
    }
    await this.ctx.storage.delete("current");
    for (const v of this.viewers()) if (this.att(v).verified) { try { v.send(JSON.stringify({ type: "live", live: false })); } catch {} }
  }
}

// ───────────────────────── Worker ─────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const room = url.searchParams.get("room") || "default";
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      return env.ROOM.get(env.ROOM.idFromName(room)).fetch(request);
    }
    // /present 由 CF Access 擋在前面（cf-gate 設定）。能走到這裡＝已登入。
    // 帶 ext_redirect（外掛的 launchWebAuthFlow）→ 把 Access JWT 交回外掛；否則顯示登入完成頁。
    if (url.pathname === "/present") return presentBridge(request, url);
    if (url.pathname === "/view" || url.pathname === "/") return html(VIEWER_HTML);
    return new Response("not found", { status: 404 });
  },
};
function html(b) { return new Response(b, { headers: { "content-type": "text/html; charset=utf-8" } }); }

// ───────────────────────── CF Access：登入橋接 + JWT 驗證 ─────────────────────────
// 外掛用 chrome.identity.launchWebAuthFlow 開 /present?ext_redirect=<chromiumapp 網址>，
// 在這裡（已過 Access）把 Cf-Access-Jwt-Assertion 以 #token=... 轉回外掛。
function presentBridge(request, url) {
  const isDev = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || (isDev ? "dev" : "");
  const redirect = url.searchParams.get("ext_redirect");
  if (redirect) {
    let ok = false;
    try { ok = new URL(redirect).hostname.endsWith(".chromiumapp.org"); } catch {}
    if (!ok) return new Response("bad redirect", { status: 400 });
    if (!token) return new Response("no access token", { status: 401 });
    return Response.redirect(redirect + "#token=" + encodeURIComponent(token), 302);
  }
  return html(SIGNED_IN_HTML);
}

const SIGNED_IN_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signed in</title><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
background:#0b1220;color:#e7ecf3;font:16px/1.5 system-ui">
<div style="text-align:center"><div style="font-size:40px">✓</div>已登入 CF Access<br>
<small style="opacity:.6">可以關掉這個分頁了</small></div></body>`;

// JWKS 快取（同一 isolate 內共用，1 小時）
let JWKS_CACHE = { keys: null, exp: 0, url: "" };
async function getJwks(certsUrl) {
  if (JWKS_CACHE.keys && JWKS_CACHE.url === certsUrl && JWKS_CACHE.exp > Date.now()) return JWKS_CACHE.keys;
  const r = await fetch(certsUrl);
  if (!r.ok) return [];
  const j = await r.json();
  JWKS_CACHE = { keys: j.keys || [], exp: Date.now() + 3600_000, url: certsUrl };
  return JWKS_CACHE.keys;
}
function b64urlBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/"); s += "=".repeat((4 - s.length % 4) % 4);
  const bin = atob(s), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
const b64urlStr = s => new TextDecoder().decode(b64urlBytes(s));

// 驗 Cloudflare Access 的 application JWT：簽章（RS256/JWKS）＋ iss / aud / exp。
async function verifyAccessJwt(token, teamDomain, aud) {
  if (!token || !teamDomain || !aud) return null;
  const p = token.split(".");
  if (p.length !== 3) return null;
  let header, payload;
  try { header = JSON.parse(b64urlStr(p[0])); payload = JSON.parse(b64urlStr(p[1])); } catch { return null; }
  const iss = "https://" + teamDomain;
  if (payload.iss !== iss) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  const jwk = (await getJwks(iss + "/cdn-cgi/access/certs")).find(k => k.kid === header.kid);
  if (!jwk) return null;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(p[2]), new TextEncoder().encode(p[0] + "." + p[1]));
    return ok ? payload : null;
  } catch { return null; }
}

// ───────────────────────── Viewer 頁（PIN → 才拿到 deck） ─────────────────────────
const VIEWER_HTML = `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Live</title>
<style>
 html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:system-ui;color:#ccc}
 .frame{position:absolute;inset:0;width:100%;height:100%;border:0;opacity:0}.frame.show{opacity:1}
 .screen{position:fixed;inset:0;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;background:#000;z-index:5}
 .hidden{display:none}
 input{font-size:28px;letter-spacing:8px;text-align:center;width:200px;padding:12px;border-radius:10px;border:0;background:#222;color:#fff}
 .screen button{font-size:18px;padding:12px 26px;border:0;border-radius:10px;background:#2b6;color:#fff}
 #err{color:#e66;font-size:14px;min-height:18px}
 #ui{position:fixed;top:0;left:0;right:0;display:flex;gap:10px;align-items:center;z-index:6;
     padding:8px 12px;color:#fff;font-size:13px;background:linear-gradient(#000a,#0000);opacity:0;transition:opacity .25s}
 body:hover #ui{opacity:1}#ui button{font-size:13px;padding:7px 12px;border:0;border-radius:8px;background:#fff2;color:#fff;cursor:pointer}
 #ui button.on{background:#2b6}#dot{margin-left:auto;opacity:.8}#nav{display:none;gap:8px}#nav.free{display:flex}
</style></head><body>
<iframe id="a" class="frame"></iframe><iframe id="b" class="frame"></iframe>

<div id="pinScreen" class="screen hidden">
 <div style="font-size:18px">輸入 PIN 進入直播</div>
 <input id="pinInput" inputmode="numeric" maxlength="8" autofocus>
 <button id="pinGo">進入</button><div id="err"></div>
</div>
<div id="waitScreen" class="screen">演講尚未開始</div>

<div id="ui" class="hidden">
 <button id="mode" class="on">跟播</button>
 <span id="nav"><button id="prev">◀</button><button id="next">▶</button><button id="resync">回到 live</button></span>
 <button id="fs">⛶ 全螢幕</button><span id="dot">connecting…</span>
</div>
<script>
 const room=new URLSearchParams(location.search).get("room")||"default";
 let A=document.getElementById("a"),B=document.getElementById("b");
 let EMBED_BASE=null,SLIDE_IDS=[],curId=null,liveId=null,follow=true,localIdx=0,isLive=false,ready=false,ws;
 const pinScreen=document.getElementById("pinScreen"),waitScreen=document.getElementById("waitScreen"),
       ui=document.getElementById("ui"),err=document.getElementById("err"),dot=document.getElementById("dot"),
       nav=document.getElementById("nav"),modeBtn=document.getElementById("mode"),pinInput=document.getElementById("pinInput");

 function slideUrl(id){ return EMBED_BASE+"#slide=id."+id; }
 function showScreen(s){ pinScreen.classList.toggle("hidden",s!=="pin"); waitScreen.classList.toggle("hidden",s!=="wait");
   ui.classList.toggle("hidden",s!=="live"); if(s==="pin")pinInput.focus(); }
 function show(id){ if(!ready||!isLive)return; if(id===curId)return; curId=id;
   B.onload=()=>{ setTimeout(()=>{ B.classList.add("show"); A.classList.remove("show"); const t=A;A=B;B=t; },60); };
   B.classList.remove("show"); B.src=slideUrl(id); }
 function setLive(v){ isLive=v; if(!ready)return;
   if(v){ showScreen("live"); if(follow&&liveId)show(liveId); }
   else { A.classList.remove("show"); B.classList.remove("show"); curId=null; setMode(true); showScreen("wait"); } }
 function setMode(f){ follow=f; modeBtn.classList.toggle("on",f); modeBtn.textContent=f?"跟播":"自由翻";
   nav.classList.toggle("free",!f); if(f&&liveId)show(liveId); }
 function localGo(n){ if(!isLive)return; localIdx=Math.max(0,Math.min(SLIDE_IDS.length-1,localIdx+n)); show(SLIDE_IDS[localIdx]); }

 document.getElementById("pinGo").onclick=sendPin;
 pinInput.addEventListener("keydown",e=>{ if(e.key==="Enter")sendPin(); });
 function sendPin(){ const p=pinInput.value.trim(); if(!p)return; err.textContent=""; ws.send(JSON.stringify({type:"pin",pin:p})); }
 modeBtn.onclick=()=>setMode(!follow);
 document.getElementById("prev").onclick=()=>localGo(-1);
 document.getElementById("next").onclick=()=>localGo(1);
 document.getElementById("resync").onclick=()=>setMode(true);
 document.getElementById("fs").onclick=()=>{ document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen(); };
 addEventListener("keydown",e=>{ if(e.key==="f"&&ready)document.getElementById("fs").click();
   if(ready&&!follow){ if(e.key==="ArrowRight")localGo(1); if(e.key==="ArrowLeft")localGo(-1); } });

 function connect(){
   const proto=location.protocol==="https:"?"wss":"ws";
   ws=new WebSocket(proto+"://"+location.host+"/ws?role=viewer&room="+encodeURIComponent(room));
   ws.onopen=()=>dot.textContent="● connected";
   ws.onmessage=e=>{ const m=JSON.parse(e.data);
     if(m.type==="need_pin"){ showScreen("pin"); }
     if(m.type==="ready"){ ready=true; EMBED_BASE=m.embedBase; SLIDE_IDS=m.slideIds||[];
       if(SLIDE_IDS.length===0){ modeBtn.style.display="none"; nav.style.display="none"; } }
     if(m.type==="live"){ setLive(m.live); if(!ready&&!m.live)showScreen("wait"); }
     if(m.type==="slide"){ liveId=m.slideId; if(Number.isInteger(m.index))localIdx=m.index; if(follow)show(m.slideId); }
     if(m.type==="denied"){ pinInput.value="";
       err.textContent = m.reason==="too_many" ? "錯太多次，已鎖定" : m.reason==="not_live" ? "目前沒有直播" : "PIN 錯誤，還可試 "+m.left+" 次"; } };
   ws.onclose=()=>{ dot.textContent="○ reconnecting…"; setTimeout(connect,1500); };
 }
 connect();
</script></body></html>`;
