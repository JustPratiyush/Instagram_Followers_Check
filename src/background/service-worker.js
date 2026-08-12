chrome.runtime.onInstalled.addListener(() => {
  console.log("Instagram Follow Check installed");
});

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "GET_LAST_RESULT") {
    chrome.storage.local.get(["igfcLastResult"], (data) => {
      sendResponse({ result: data.igfcLastResult || null });
    });
    return true;
  }

  if (message && message.type === "OPEN_INSTAGRAM") {
    chrome.tabs.create({ url: "https://www.instagram.com/" });
    sendResponse({ ok: true });
    return false;
  }

  if (message && message.type === "FETCH_AVATAR" && message.url) {
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
