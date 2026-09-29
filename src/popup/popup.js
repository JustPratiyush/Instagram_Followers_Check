// Recent checks live in the popup's own localStorage: this browser only, never sent anywhere.
var RECENT_KEY = "igfc.recent";
var RECENT_MAX = 5;

var form = document.getElementById("checkForm");
var input = document.getElementById("username");
var checkBtn = document.getElementById("checkBtn");
var selfBtn = document.getElementById("selfBtn");
var statusEl = document.getElementById("status");
var recentSection = document.getElementById("recent");
var recentList = document.getElementById("recentList");

function isInstagram(url) {
  return Boolean(url && /^https:\/\/www\.instagram\.com\//.test(url));
}

// Accepts "name", "@name" or a profile link; returns "" if it isn't a valid username.
function normalizeUsername(raw) {
  var value = String(raw || "").trim();
  var fromUrl = value.match(/instagram\.com\/([^/?#\s]+)/i);
  if (fromUrl) value = fromUrl[1];
  value = value.replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(value) ? value : "";
}

function showStatus(message, isError) {
  statusEl.textContent = message;
  statusEl.hidden = !message;
  statusEl.classList.toggle("error", Boolean(isError));
}

function setBusy(busy) {
  checkBtn.disabled = busy;
  selfBtn.disabled = busy;
}

function loadRecent() {
  try {
    var list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    if (!Array.isArray(list)) return [];
    return list
      .filter(function (name) {
        return normalizeUsername(name) === name;
      })
      .slice(0, RECENT_MAX);
  } catch (_) {
    return [];
  }
}

function saveRecent(list) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch (_) {}
}

function rememberUsername(username) {
  var list = loadRecent().filter(function (name) {
    return name !== username;
  });
  list.unshift(username);
  saveRecent(list);
}

function renderRecent() {
  var list = loadRecent();
  recentSection.hidden = !list.length;
  recentList.textContent = "";
  list.forEach(function (username) {
    var item = document.createElement("li");

    var pick = document.createElement("button");
    pick.type = "button";
    pick.className = "recent-pick";
    pick.textContent = "@" + username;
    pick.addEventListener("click", function () {
      input.value = username;
      check(username);
    });

    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "recent-remove";
    remove.textContent = "×";
    remove.title = "Remove from recent";
    remove.setAttribute("aria-label", "Remove @" + username + " from recent");
    remove.addEventListener("click", function () {
      saveRecent(
        loadRecent().filter(function (name) {
          return name !== username;
        })
      );
      renderRecent();
    });

    item.appendChild(pick);
    item.appendChild(remove);
    recentList.appendChild(item);
  });
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

// Opens the panel in an Instagram tab. With a username it checks that account
// right away; without one it only opens the panel, and the user starts the scan
// there after seeing the disclosure.
async function openPanel(username) {
  setBusy(true);
  var tab = await findInstagramTab();

  if (!tab) {
    showStatus("Opening Instagram…");
    await chrome.runtime.sendMessage({
      type: "OPEN_INSTAGRAM",
      openPanel: true,
      username: username,
    });
    window.close();
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "IGFC_OPEN", username: username });
  } catch (_) {
    setBusy(false);
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

function check(raw) {
  var username = normalizeUsername(raw);
  if (!username) {
    showStatus("Enter an Instagram username, like natgeo.", true);
    input.focus();
    return;
  }
  rememberUsername(username);
  renderRecent();
  showStatus("");
  openPanel(username);
}

form.addEventListener("submit", function (event) {
  event.preventDefault();
  check(input.value);
});

input.addEventListener("input", function () {
  if (statusEl.classList.contains("error")) showStatus("");
});

selfBtn.addEventListener("click", function () {
  showStatus("");
  openPanel("");
});

document.getElementById("version").textContent =
  "v" + chrome.runtime.getManifest().version;
renderRecent();
input.focus();
