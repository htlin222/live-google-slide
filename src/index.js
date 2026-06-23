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
    const key = url.searchParams.get("key") || "";
    const role = (wantP && this.env.PRESENT_KEY && key === this.env.PRESENT_KEY) ? "presenter" : "viewer";

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [role]);
    try { server.send(JSON.stringify({ type: "role", role })); } catch {}

    if (role === "presenter") {
      await this.ctx.storage.deleteAlarm();
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
    if (this.presenters().length === 0) {
      await this.ctx.storage.delete("current");
      for (const v of this.viewers()) if (this.att(v).verified) { try { v.send(JSON.stringify({ type: "live", live: false })); } catch {} }
    }
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
    if (url.pathname === "/present") return html(PRESENTER_HTML);
    if (url.pathname === "/view" || url.pathname === "/") return html(VIEWER_HTML);
    return new Response("not found", { status: 404 });
  },
};
function html(b) { return new Response(b, { headers: { "content-type": "text/html; charset=utf-8" } }); }

// ───────────────────────── 每份簡報填這裡（只在 presenter 頁） ─────────────────────────
const DECK = `
  const EMBED_BASE = "https://docs.google.com/presentation/d/e/PASTE_PUBLISHED_ID/embed?start=false&loop=false&rm=minimal";
  const SLIDE_IDS  = ["g_id_p", "g_id_2", "g_id_3"];
`;

// ───────────────────────── Presenter 頁 ─────────────────────────
const PRESENTER_HTML = `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Presenter</title>
<style>
 html,body{margin:0;height:100%;background:#111;color:#eee;font-family:system-ui}
 #stage{height:80vh}iframe{width:100%;height:100%;border:0}
 #bar{height:20vh;display:flex;gap:12px;align-items:center;justify-content:center}
 button{font-size:20px;padding:14px 28px;border:0;border-radius:10px;background:#2b6;color:#fff}
 button:disabled{opacity:.4}#pos{font-size:18px;min-width:90px;text-align:center}
 #dot{position:fixed;top:10px;left:14px;font-size:13px;opacity:.85}
</style></head><body>
<div id="dot">connecting…</div>
<div id="stage"><iframe id="f"></iframe></div>
<div id="bar"><button id="prev">◀ Prev</button><span id="pos"></span><button id="next">Next ▶</button></div>
<script>
${DECK}
 const q=new URLSearchParams(location.search);
 const room=q.get("room")||"default", key=q.get("key")||"", pin=q.get("pin")||"";
 const f=document.getElementById("f"),pos=document.getElementById("pos"),dot=document.getElementById("dot");
 let i=0,ws;
 function slideUrl(id){ return EMBED_BASE+"#slide=id."+id; }
 function render(){ f.src=slideUrl(SLIDE_IDS[i]); pos.textContent=(i+1)+" / "+SLIDE_IDS.length;
   document.getElementById("prev").disabled=i===0; document.getElementById("next").disabled=i===SLIDE_IDS.length-1; }
 function push(){ render(); if(ws&&ws.readyState===1) ws.send(JSON.stringify({type:"slide",index:i,slideId:SLIDE_IDS[i]})); }
 function go(n){ i=Math.max(0,Math.min(SLIDE_IDS.length-1,i+n)); push(); }
 function connect(){
   const proto=location.protocol==="https:"?"wss":"ws";
   ws=new WebSocket(proto+"://"+location.host+"/ws?role=presenter&room="+encodeURIComponent(room)+"&key="+encodeURIComponent(key));
   ws.onopen=()=>{ ws.send(JSON.stringify({type:"init",pin:pin,embedBase:EMBED_BASE,slideIds:SLIDE_IDS}));
     dot.textContent="● 直播中"+(pin?"　PIN："+pin:"")+"（關掉分頁就結束）"; push(); };
   ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.type==="role"&&m.role!=="presenter") dot.textContent="○ read-only（控制密碼錯）";};
   ws.onclose=()=>{dot.textContent="○ reconnecting…";setTimeout(connect,1500);};
 }
 document.getElementById("prev").onclick=()=>go(-1);
 document.getElementById("next").onclick=()=>go(1);
 addEventListener("keydown",e=>{ if(e.key==="ArrowRight"||e.key===" ")go(1); if(e.key==="ArrowLeft")go(-1); });
 render(); connect();
</script></body></html>`;

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
