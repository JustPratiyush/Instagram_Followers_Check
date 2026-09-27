async function getActiveTab() {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function isInstagram(url) {
  return Boolean(url && /^https:\/\/www\.instagram\.com\//.test(url));
}

async function init() {
  var status = document.getElementById("status");
  var openBtn = document.getElementById("openBtn");
  var igBtn = document.getElementById("igBtn");

  var tab = await getActiveTab();
  if (!tab || !isInstagram(tab.url)) {
    status.textContent =
      "Open Instagram in this browser and log in, then come back here.";
    openBtn.textContent = "Go to Instagram";
    openBtn.onclick = function () {
      chrome.runtime.sendMessage({ type: "OPEN_INSTAGRAM" });
      window.close();
    };
  } else {
    status.textContent =
      "Instagram tab detected. Open the panel to scan followers & following.";
    openBtn.onclick = async function () {
      try {
        // Opens the panel only; the user starts the scan there after seeing the disclosure.
        await chrome.tabs.sendMessage(tab.id, { type: "IGFC_OPEN" });
        window.close();
      } catch (err) {
        status.textContent =
          "Could not reach the page script. Refresh Instagram and try again.";
      }
    };
  }

  igBtn.onclick = function () {
    chrome.runtime.sendMessage({ type: "OPEN_INSTAGRAM" });
  };
}

init();
