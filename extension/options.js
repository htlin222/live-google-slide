const $ = id => document.getElementById(id);

chrome.storage.sync.get(["cfUrl", "key"]).then(g => {
  $("cfUrl").value = g.cfUrl || "";
  $("key").value = g.key || "";
});

$("save").onclick = async () => {
  const cfUrl = $("cfUrl").value.trim().replace(/\/$/, "");
  const key = $("key").value;
  await chrome.storage.sync.set({ cfUrl, key });
  $("ok").textContent = "已儲存 ✓";
  setTimeout(() => ($("ok").textContent = ""), 1500);
};
