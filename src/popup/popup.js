var openBtn = document.getElementById("openBtn");
var statusEl = document.getElementById("status");

function isInstagram(url) {
  return Boolean(url && /^https:\/\/www\.instagram\.com\//.test(url));
}

function showStatus(message, isError) {
  statusEl.textContent = message;
  statusEl.hidden = !message;
  statusEl.classList.toggle("error", Boolean(isError));
}

async function findInstagramTab() {
  var active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (active && isInstagram(active.url)) return active;
  var tabs = await chrome.tabs.query({
    currentWindow: true,
    url: "https://www.instagram.com/*",
  });
  return tabs[0] || null;
}

// Opens the panel in an Instagram tab (opening Instagram first if needed). It
// only opens the panel: the user starts the scan there after seeing the disclosure.
async function openPanel() {
  openBtn.disabled = true;
  var tab = await findInstagramTab();

  if (!tab) {
    showStatus("Opening Instagram…");
    await chrome.runtime.sendMessage({ type: "OPEN_INSTAGRAM", openPanel: true });
    window.close();
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "IGFC_OPEN" });
  } catch (_) {
    openBtn.disabled = false;
    showStatus(
      "Couldn't reach your Instagram tab. Refresh it, then try again.",
      true
    );
    return;
  }
  // Switching tabs closes the popup, so this goes last.
  if (!tab.active) await chrome.tabs.update(tab.id, { active: true });
  window.close();
}

openBtn.addEventListener("click", function () {
  showStatus("");
  openPanel();
});

document.getElementById("version").textContent =
  "v" + chrome.runtime.getManifest().version;
