// 在 Google Slides 頁面執行——編輯或放映模式皆可，不需特地進「簡報模式」。
// 回報兩件事給 background：目前這份 deck 的 embed 網址、以及當前 slide objectId。
// embed 與 slide id 都來自「同一個現場頁面」，保證一致（不吃任何舊的儲存值）。

const embedFromUrl = (u) => {
	const m = (u || "").match(/\/presentation\/d\/([^/]+)/);
	return m
		? `https://docs.google.com/presentation/d/${m[1]}/embed?start=false&loop=false&rm=minimal`
		: "";
};
function currentSlideId() {
	// 編輯模式翻頁改 query（?slide=id.X），放映模式改 hash（#slide=id.X）；兩邊都讀。
	const m = (location.hash + location.search).match(/slide=id\.([^&/?#]+)/);
	return m ? m[1] : null;
}

let lastDeck = null,
	lastSlide = null;
function pushDeck() {
	const e = embedFromUrl(location.href);
	if (e && e !== lastDeck) {
		lastDeck = e;
		chrome.runtime.sendMessage({ type: "deck", embedBase: e }).catch(() => {});
	}
}
function tick() {
	pushDeck();
	const id = currentSlideId();
	if (id && id !== lastSlide) {
		lastSlide = id;
		chrome.runtime.sendMessage({ type: "slide", slideId: id }).catch(() => {});
	}
}

let queued = false;
function queueTick() {
	if (queued) return;
	queued = true;
	queueMicrotask(() => {
		queued = false;
		tick();
	});
}

for (const name of ["pushState", "replaceState"]) {
	const original = history[name];
	history[name] = function (...args) {
		const result = original.apply(this, args);
		queueTick();
		return result;
	};
}

window.addEventListener("hashchange", queueTick);
window.addEventListener("popstate", queueTick);
// 編輯模式翻頁是 pushState（不會觸發事件），所以靠較密的輪詢補捉，降低延遲。
setInterval(tick, 75);

// 心跳：分頁開著就每 20 秒戳一下 background，避免 MV3 service worker 被回收
//（伺服器端也會每 10 秒 ping 保活，雙保險）。
setInterval(
	() => chrome.runtime.sendMessage({ type: "hb" }).catch(() => {}),
	20000,
);

// 載入後若先前已按「開始直播」，請 background 用儲存的設定自動重連
chrome.runtime.sendMessage({ type: "resume" }).catch(() => {});
tick();
