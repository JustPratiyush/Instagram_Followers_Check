(function () {
  if (window.__IGFC_CONTENT__) return;
  window.__IGFC_CONTENT__ = true;

  var BRIDGE_SOURCE = "ig-follow-check-bridge";
  var CONTENT_SOURCE = "ig-follow-check-content";
  var state = {
    open: false,
    scanning: false,
    requestId: 0,
    actionRequestId: 0,
    activeTab: "notFollowingBack",
    query: "",
    viewer: null,
    followers: [],
    following: [],
    comparison: null,
    status: "Ready. Make sure you are logged into Instagram in this tab.",
    error: "",
    pendingActions: {},
  };

  var avatarCache = {};
  var avatarInflight = {};

  function compareLists(followers, following) {
    var followerMap = {};
    var followingMap = {};
    var i;

    for (i = 0; i < followers.length; i++) {
      followerMap[followers[i].username.toLowerCase()] = followers[i];
    }
    for (i = 0; i < following.length; i++) {
      followingMap[following[i].username.toLowerCase()] = following[i];
    }

    var mutual = [];
    var notFollowingBack = [];
    var notFollowedBack = [];

    Object.keys(followingMap).forEach(function (key) {
      if (followerMap[key]) mutual.push(followingMap[key]);
      else notFollowingBack.push(followingMap[key]);
    });

    Object.keys(followerMap).forEach(function (key) {
      if (!followingMap[key]) notFollowedBack.push(followerMap[key]);
    });

    function byName(a, b) {
      return a.username.localeCompare(b.username, undefined, {
        sensitivity: "base",
      });
    }

    mutual.sort(byName);
    notFollowingBack.sort(byName);
    notFollowedBack.sort(byName);

    return {
      mutual: mutual,
      notFollowingBack: notFollowingBack,
      notFollowedBack: notFollowedBack,
      counts: {
        followers: followers.length,
        following: following.length,
        mutual: mutual.length,
        notFollowingBack: notFollowingBack.length,
        notFollowedBack: notFollowedBack.length,
      },
    };
  }

  function injectBridge() {
    var version = chrome.runtime.getManifest().version;
    if (document.documentElement.dataset.igfcBridge === version) return;

    var script = document.createElement("script");
    script.src =
      chrome.runtime.getURL("src/content/page-bridge.js") + "?v=" + version;
    script.async = false;
    script.onload = function () {
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
    document.documentElement.dataset.igfcBridge = version;
  }

  function postToBridge(payload) {
    payload.source = CONTENT_SOURCE;
    window.postMessage(payload, "*");
  }

  function el(tag, className, attrs) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === "text") node.textContent = attrs[key];
        else node.setAttribute(key, attrs[key]);
      });
    }
    return node;
  }

  var root;
  var refs = {};

  function ensureUi() {
    if (root) return;

    root = el("div", null, { id: "igfc-root" });

    var fab = el("button", "igfc-fab", {
      type: "button",
      title: "Instagram Follow Check",
    });
    fab.appendChild(el("span", "igfc-fab-dot"));
    fab.appendChild(document.createTextNode("Follow Check"));
    fab.addEventListener("click", function () {
      setOpen(true);
    });

    var backdrop = el("div", "igfc-backdrop igfc-hidden");
    backdrop.addEventListener("click", function () {
      setOpen(false);
    });

    var panel = el("div", "igfc-panel igfc-hidden");

    var header = el("div", "igfc-header");
    var titleWrap = el("div", "igfc-title-wrap");
    titleWrap.appendChild(el("h1", null, { text: "Instagram Follow Check" }));
    titleWrap.appendChild(
      el("p", null, {
        text: "Uses your already-logged-in Instagram session. No passwords. Compares followers vs following.",
      })
    );
    var closeBtn = el("button", "igfc-close", { type: "button", text: "×" });
    closeBtn.addEventListener("click", function () {
      setOpen(false);
    });
    header.appendChild(titleWrap);
    header.appendChild(closeBtn);

    var progress = el("div", "igfc-progress igfc-hidden");
    progress.appendChild(document.createElement("i"));

    var toolbar = el("div", "igfc-toolbar");
    var actions = el("div", "igfc-actions");
    var scanBtn = el("button", "igfc-btn igfc-btn-primary", {
      type: "button",
      text: "Scan my lists",
    });
    scanBtn.addEventListener("click", startScan);
    var exportBtn = el("button", "igfc-btn", {
      type: "button",
      text: "Export CSV",
    });
    exportBtn.addEventListener("click", exportCsv);
    actions.appendChild(scanBtn);
    actions.appendChild(exportBtn);
    var status = el("div", "igfc-status");
    toolbar.appendChild(actions);
    toolbar.appendChild(status);

    var stats = el("div", "igfc-stats");
    var tabs = el("div", "igfc-tabs");
    var searchRow = el("div", "igfc-search-row");
    var search = el("input", "igfc-search", {
      type: "search",
      placeholder: "Search username or name…",
    });
    search.addEventListener("input", function () {
      state.query = search.value.trim().toLowerCase();
      renderTable();
    });
    searchRow.appendChild(search);

    var body = el("div", "igfc-body");

    panel.appendChild(header);
    panel.appendChild(progress);
    panel.appendChild(toolbar);
    panel.appendChild(stats);
    panel.appendChild(tabs);
    panel.appendChild(searchRow);
    panel.appendChild(body);

    root.appendChild(fab);
    root.appendChild(backdrop);
    root.appendChild(panel);
    document.documentElement.appendChild(root);

    refs = {
      fab: fab,
      backdrop: backdrop,
      panel: panel,
      progress: progress,
      scanBtn: scanBtn,
      exportBtn: exportBtn,
      status: status,
      stats: stats,
      tabs: tabs,
      search: search,
      body: body,
    };

    renderAll();
  }

  function setOpen(open) {
    state.open = open;
    ensureUi();
    refs.backdrop.classList.toggle("igfc-hidden", !open);
    refs.panel.classList.toggle("igfc-hidden", !open);
    refs.fab.classList.toggle("igfc-hidden", open);
    requestAnimationFrame(function () {
      refs.backdrop.classList.toggle("igfc-open", open);
      refs.panel.classList.toggle("igfc-open", open);
    });
  }

  function startScan() {
    if (state.scanning) return;
    injectBridge();
    state.scanning = true;
    state.error = "";
    state.status = "Connecting to your Instagram session…";
    state.requestId += 1;
    var requestId = state.requestId;
    renderAll();

    // Small delay so bridge can boot if just injected
    setTimeout(function () {
      postToBridge({ type: "scan", requestId: requestId });
    }, 60);
  }

  function onBridgeMessage(event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.source !== BRIDGE_SOURCE) return;

    if (data.type === "ready") {
      return;
    }

    if (data.type === "friendshipResult") {
      var key = String(data.userId || data.username || "");
      delete state.pendingActions[key];

      if (!data.ok) {
        state.status =
          "Action failed" +
          (data.username ? " for @" + data.username : "") +
          ": " +
          (data.message || "unknown error");
        renderChrome();
        renderTable();
        return;
      }

      applyFriendshipLocally(data.action, data.userId, data.username);
      state.status =
        data.action === "destroy"
          ? "Removed @" + data.username
          : "Followed @" + data.username;
      persistResult();
      renderAll();
      return;
    }

    if (data.requestId && data.requestId !== state.requestId) return;

    if (data.type === "progress") {
      state.status = data.message || "Working…";
      if (data.viewer) state.viewer = data.viewer;
      renderChrome();
      return;
    }

    if (data.type === "error") {
      state.scanning = false;
      state.error = data.message || "Something went wrong.";
      state.status = "Scan failed.";
      renderAll();
      return;
    }

    if (data.type === "result") {
      state.scanning = false;
      state.viewer = data.viewer;
      state.followers = data.followers || [];
      state.following = data.following || [];
      state.comparison = compareLists(state.followers, state.following);
      state.status =
        "Done for @" +
        (state.viewer && state.viewer.username
          ? state.viewer.username
          : "you") +
        ".";
      state.error = "";
      persistResult();
      renderAll();
    }
  }

  function removeByUsername(list, username) {
    var target = (username || "").toLowerCase();
    return list.filter(function (u) {
      return u.username.toLowerCase() !== target;
    });
  }

  function findUser(list, userId, username) {
    var id = String(userId || "");
    var name = (username || "").toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if (
        (id && String(list[i].pk) === id) ||
        (name && list[i].username.toLowerCase() === name)
      ) {
        return list[i];
      }
    }
    return null;
  }

  function applyFriendshipLocally(action, userId, username) {
    if (action === "destroy") {
      state.following = removeByUsername(state.following, username);
    } else if (action === "create") {
      var existing =
        findUser(state.followers, userId, username) ||
        findUser(state.following, userId, username);
      if (existing && !findUser(state.following, userId, username)) {
        state.following = state.following.concat([existing]);
      }
    }
    state.comparison = compareLists(state.followers, state.following);
  }

  function runFriendshipAction(user, action) {
    if (!user || !user.pk) {
      state.status = "Missing user id — rescan your lists and try again.";
      renderChrome();
      return;
    }
    var key = String(user.pk);
    if (state.pendingActions[key]) return;

    injectBridge();
    state.pendingActions[key] = action;
    state.actionRequestId += 1;
    state.status =
      (action === "destroy" ? "Removing @" : "Following @") +
      user.username +
      "…";
    renderChrome();
    renderTable();

    postToBridge({
      type: "friendship",
      requestId: state.actionRequestId,
      action: action,
      userId: user.pk,
      username: user.username,
    });
  }

  function persistResult() {
    try {
      chrome.storage.local.set({
        igfcLastResult: {
          savedAt: Date.now(),
          viewer: state.viewer,
          comparison: {
            counts: state.comparison.counts,
            mutual: state.comparison.mutual,
            notFollowingBack: state.comparison.notFollowingBack,
            notFollowedBack: state.comparison.notFollowedBack,
          },
          followers: state.followers,
          following: state.following,
        },
      });
    } catch (_) {}
  }

  function currentList() {
    if (!state.comparison) return [];
    return state.comparison[state.activeTab] || [];
  }

  function filteredList() {
    var list = currentList();
    if (!state.query) return list;
    return list.filter(function (u) {
      return (
        u.username.toLowerCase().indexOf(state.query) !== -1 ||
        (u.full_name || "").toLowerCase().indexOf(state.query) !== -1
      );
    });
  }

  function renderChrome() {
    ensureUi();
    refs.scanBtn.disabled = state.scanning;
    refs.exportBtn.disabled = !state.comparison;
    refs.scanBtn.textContent = state.scanning ? "Scanning…" : "Scan my lists";
    refs.status.textContent = state.status;
    refs.progress.classList.toggle("igfc-hidden", !state.scanning);
  }

  function renderStats() {
    var counts = (state.comparison && state.comparison.counts) || {
      followers: 0,
      following: 0,
      mutual: 0,
      notFollowingBack: 0,
      notFollowedBack: 0,
    };

    var items = [
      ["Followers", counts.followers],
      ["Following", counts.following],
      ["Follow back", counts.mutual],
      ["Don't follow you", counts.notFollowingBack],
      ["You don't follow", counts.notFollowedBack],
    ];

    refs.stats.innerHTML = "";
    items.forEach(function (item) {
      var card = el("div", "igfc-stat");
      card.appendChild(el("span", null, { text: item[0] }));
      card.appendChild(el("strong", null, { text: String(item[1]) }));
      refs.stats.appendChild(card);
    });
  }

  function renderTabs() {
    var counts = (state.comparison && state.comparison.counts) || {
      mutual: 0,
      notFollowingBack: 0,
      notFollowedBack: 0,
    };
    var defs = [
      ["notFollowingBack", "Don't follow you back", counts.notFollowingBack],
      ["notFollowedBack", "You don't follow back", counts.notFollowedBack],
      ["mutual", "Follow each other", counts.mutual],
      ["followers", "All followers", (state.followers || []).length],
      ["following", "All following", (state.following || []).length],
    ];

    refs.tabs.innerHTML = "";
    defs.forEach(function (def) {
      var btn = el("button", "igfc-tab", {
        type: "button",
        "data-tab": def[0],
        text: def[1] + " (" + def[2] + ")",
      });
      if (state.activeTab === def[0]) btn.classList.add("igfc-active");
      btn.addEventListener("click", function () {
        state.activeTab = def[0];
        renderTabs();
        renderTable();
      });
      refs.tabs.appendChild(btn);
    });
  }

  function fallbackAvatar(user) {
    return el("span", "igfc-avatar-fallback", {
      text: (user.username || "?").slice(0, 1).toUpperCase(),
    });
  }

  function loadAvatar(img, url, cacheKey) {
    if (!url) return;
    if (avatarCache[cacheKey]) {
      img.src = avatarCache[cacheKey];
      return;
    }

    img.src = url;
    img.addEventListener("error", function onDirectFail() {
      img.removeEventListener("error", onDirectFail);
      if (avatarInflight[cacheKey]) {
        avatarInflight[cacheKey].then(function (dataUrl) {
          if (dataUrl) img.src = dataUrl;
          else img.replaceWith(fallbackAvatar({ username: cacheKey }));
        });
        return;
      }

      avatarInflight[cacheKey] = new Promise(function (resolve) {
        try {
          chrome.runtime.sendMessage(
            { type: "FETCH_AVATAR", url: url },
            function (response) {
              if (chrome.runtime.lastError || !response || !response.ok) {
                resolve(null);
                return;
              }
              avatarCache[cacheKey] = response.dataUrl;
              resolve(response.dataUrl);
            }
          );
        } catch (_) {
          resolve(null);
        }
      }).finally(function () {
        delete avatarInflight[cacheKey];
      });

      avatarInflight[cacheKey].then(function (dataUrl) {
        if (dataUrl) img.src = dataUrl;
        else img.replaceWith(fallbackAvatar({ username: img.dataset.username || "?" }));
      });
    });
  }

  function avatarNode(user) {
    if (!user.profile_pic_url) return fallbackAvatar(user);

    var cacheKey = user.pk || user.username;
    var img = el("img", "igfc-avatar", {
      alt: "@" + user.username,
      referrerpolicy: "no-referrer",
      loading: "lazy",
      decoding: "async",
    });
    img.dataset.username = user.username;
    if (avatarCache[cacheKey]) {
      img.src = avatarCache[cacheKey];
    } else {
      loadAvatar(img, user.profile_pic_url, cacheKey);
    }
    return img;
  }

  function actionButtonFor(user) {
    if (state.activeTab === "notFollowingBack") {
      var removing = state.pendingActions[String(user.pk)] === "destroy";
      var removeBtn = el("button", "igfc-row-btn igfc-row-btn-remove", {
        type: "button",
        text: removing ? "Removing…" : "Remove",
      });
      removeBtn.disabled = removing;
      removeBtn.addEventListener("click", function () {
        runFriendshipAction(user, "destroy");
      });
      return removeBtn;
    }

    if (state.activeTab === "notFollowedBack") {
      var following = state.pendingActions[String(user.pk)] === "create";
      var followBtn = el("button", "igfc-row-btn igfc-row-btn-follow", {
        type: "button",
        text: following ? "Following…" : "Follow back",
      });
      followBtn.disabled = following;
      followBtn.addEventListener("click", function () {
        runFriendshipAction(user, "create");
      });
      return followBtn;
    }

    return null;
  }

  function renderTable() {
    refs.body.innerHTML = "";

    if (state.error) {
      refs.body.appendChild(el("div", "igfc-error", { text: state.error }));
      return;
    }

    if (!state.comparison) {
      refs.body.appendChild(
        el("div", "igfc-empty", {
          text: "Click “Scan my lists” to load your followers and following from this logged-in session, then compare them.",
        })
      );
      return;
    }

    var list;
    if (state.activeTab === "followers") list = state.followers;
    else if (state.activeTab === "following") list = state.following;
    else list = currentList();

    if (state.query) {
      list = list.filter(function (u) {
        return (
          u.username.toLowerCase().indexOf(state.query) !== -1 ||
          (u.full_name || "").toLowerCase().indexOf(state.query) !== -1
        );
      });
    }

    if (!list.length) {
      refs.body.appendChild(
        el("div", "igfc-empty", { text: "No people in this list." })
      );
      return;
    }

    var showActions =
      state.activeTab === "notFollowingBack" ||
      state.activeTab === "notFollowedBack";

    var table = el("table", "igfc-table");
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    var headers = ["#", "Account", "Name"];
    if (showActions) headers.push("Action");
    headers.forEach(function (label) {
      var th = el("th", null, { text: label });
      if (label === "#") th.className = "igfc-col-num";
      if (label === "Action") th.className = "igfc-col-action";
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    list.forEach(function (user, index) {
      var tr = document.createElement("tr");

      var numTd = el("td", "igfc-col-num", { text: String(index + 1) });
      tr.appendChild(numTd);

      var userTd = document.createElement("td");
      var wrap = el("div", "igfc-user");
      wrap.appendChild(avatarNode(user));
      var textWrap = el("div", "igfc-user-text");
      var link = el("a", null, {
        href: "https://www.instagram.com/" + user.username + "/",
        target: "_blank",
        rel: "noopener noreferrer",
        text: "@" + user.username,
      });
      textWrap.appendChild(link);
      wrap.appendChild(textWrap);
      userTd.appendChild(wrap);
      tr.appendChild(userTd);

      tr.appendChild(el("td", null, { text: user.full_name || "—" }));

      if (showActions) {
        var actionTd = el("td", "igfc-col-action");
        var btn = actionButtonFor(user);
        if (btn) actionTd.appendChild(btn);
        tr.appendChild(actionTd);
      }

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    refs.body.appendChild(table);
  }

  function renderAll() {
    renderChrome();
    renderStats();
    renderTabs();
    renderTable();
  }

  function csvEscape(value) {
    var s = String(value == null ? "" : value);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCsv() {
    if (!state.comparison) return;
    var rows = [["category", "username", "full_name", "profile_url"]];
    function add(category, list) {
      list.forEach(function (u) {
        rows.push([
          category,
          u.username,
          u.full_name || "",
          "https://www.instagram.com/" + u.username + "/",
        ]);
      });
    }
    add("mutual", state.comparison.mutual);
    add("not_following_back", state.comparison.notFollowingBack);
    add("not_followed_back", state.comparison.notFollowedBack);

    var csv = rows
      .map(function (row) {
        return row.map(csvEscape).join(",");
      })
      .join("\n");

    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download =
      "instagram-follow-check-" +
      ((state.viewer && state.viewer.username) || "me") +
      ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  window.addEventListener("message", onBridgeMessage);

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (message && message.type === "IGFC_OPEN") {
      ensureUi();
      setOpen(true);
      if (message.autoScan) startScan();
      sendResponse({ ok: true });
      return false;
    }
    if (message && message.type === "IGFC_STATUS") {
      sendResponse({
        ok: true,
        scanning: state.scanning,
        hasResult: Boolean(state.comparison),
        viewer: state.viewer,
        counts: state.comparison && state.comparison.counts,
      });
      return false;
    }
    return false;
  });

  // Boot floating button on Instagram pages
  function boot() {
    injectBridge();
    ensureUi();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
