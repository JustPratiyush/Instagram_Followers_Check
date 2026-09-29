chrome.runtime.onInstalled.addListener(() => {
  console.log("Follow Check for Instagram installed");
});

// Only these image CDNs are covered by host_permissions; never fetch anything else.
var AVATAR_HOST_SUFFIXES = [".cdninstagram.com", ".fbcdn.net"];

function isAllowedAvatarUrl(url) {
  try {
    var parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return AVATAR_HOST_SUFFIXES.some(function (suffix) {
      return parsed.hostname.endsWith(suffix);
    });
  } catch (_) {
    return false;
  }
}

function arrayBufferToBase64(buffer) {
  var bytes = new Uint8Array(buffer);
  var chunk = 0x8000;
  var binary = "";
  for (var i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + chunk, bytes.length))
    );
  }
  return btoa(binary);
}

async function fetchAvatarDataUrl(url) {
  var res = await fetch(url, {
    method: "GET",
    credentials: "omit",
    cache: "force-cache",
    referrerPolicy: "no-referrer",
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error("Avatar HTTP " + res.status);
  var contentType = res.headers.get("content-type") || "image/jpeg";
  var buffer = await res.arrayBuffer();
  var base64 = arrayBufferToBase64(buffer);
  return "data:" + contentType.split(";")[0] + ";base64," + base64;
}

// The popup closes as soon as a new tab opens, so the worker hands the panel
// request to the tab once its content script is up.
function openPanelWhenReady(tabId, panelMessage) {
  var tries = 0;
  function attempt() {
    chrome.tabs.sendMessage(tabId, panelMessage).catch(function () {
      tries += 1;
      if (tries < 15) setTimeout(attempt, 1000);
    });
  }
  function onUpdated(updatedId, info) {
    if (updatedId !== tabId || info.status !== "complete") return;
    chrome.tabs.onUpdated.removeListener(onUpdated);
    attempt();
  }
  chrome.tabs.onUpdated.addListener(onUpdated);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "OPEN_INSTAGRAM") {
    chrome.tabs.create({ url: "https://www.instagram.com/" }, function (tab) {
      if (message.openPanel && tab) {
        openPanelWhenReady(tab.id, {
          type: "IGFC_OPEN",
          username: message.username || "",
        });
      }
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message && message.type === "FETCH_AVATAR") {
    if (!isAllowedAvatarUrl(message.url)) {
      sendResponse({ ok: false, error: "Avatar host not allowed" });
      return false;
    }
    fetchAvatarDataUrl(message.url)
      .then(function (dataUrl) {
        sendResponse({ ok: true, dataUrl: dataUrl });
      })
      .catch(function (err) {
        sendResponse({
          ok: false,
          error: (err && err.message) || String(err),
        });
      });
    return true;
  }

  return false;
});
