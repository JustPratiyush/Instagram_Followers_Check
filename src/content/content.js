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
    notFollowingFilter: "all",
    query: "",
    viewer: null,
    followers: [],
    following: [],
    comparison: null,
    status: "Ready",
    error: "",
    pendingActions: {},
    scanStage: "",
    followersLoaded: 0,
    followingLoaded: 0,
    progressPct: 0,
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

    var notFollowingVerified = notFollowingBack.filter(function (u) {
      return Boolean(u.is_verified);
    });
    var notFollowingUnverified = notFollowingBack.filter(function (u) {
      return !u.is_verified;
    });

    return {
      mutual: mutual,
      notFollowingBack: notFollowingBack,
      notFollowingVerified: notFollowingVerified,
      notFollowingUnverified: notFollowingUnverified,
      notFollowedBack: notFollowedBack,
      counts: {
        followers: followers.length,
        following: following.length,
        mutual: mutual.length,
        notFollowingBack: notFollowingBack.length,
        notFollowingVerified: notFollowingVerified.length,
        notFollowingUnverified: notFollowingUnverified.length,
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
    header.appendChild(el("h1", "igfc-title", { text: "Instagram Follow Check" }));

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
    var closeBtn = el("button", "igfc-close", { type: "button", text: "×" });
    closeBtn.addEventListener("click", function () {
      setOpen(false);
    });

    header.appendChild(actions);
    header.appendChild(status);
    header.appendChild(closeBtn);

    var progress = el("div", "igfc-progress igfc-hidden");
    var progressBar = document.createElement("i");
    progress.appendChild(progressBar);

    var stats = el("div", "igfc-stats");
    var subfilters = el("div", "igfc-subfilters igfc-hidden");
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
    panel.appendChild(stats);
    panel.appendChild(subfilters);
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
      progressBar: progressBar,
      actions: actions,
      scanBtn: scanBtn,
      exportBtn: exportBtn,
      status: status,
      stats: stats,
      subfilters: subfilters,
      searchRow: searchRow,
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
    state.status = "Connecting…";
    state.scanStage = "viewer";
    state.followersLoaded = 0;
    state.followingLoaded = 0;
    state.progressPct = 4;
    state.requestId += 1;
    var requestId = state.requestId;
    renderAll();

    setTimeout(function () {
      postToBridge({ type: "scan", requestId: requestId });
    }, 60);
  }

  function estimateProgress(stage, loaded, followersCount) {
    if (stage === "viewer") return 8;
    if (stage === "followers") {
      return Math.min(48, 12 + Math.floor((loaded || 0) / 8));
    }
    if (stage === "following") {
      var base = 52;
      var fromFollowing = Math.min(42, Math.floor((loaded || 0) / 8));
      var bonus = followersCount ? 4 : 0;
      return Math.min(96, base + fromFollowing + bonus);
    }
    return state.progressPct || 10;
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
      if (data.stage) state.scanStage = data.stage;
      if (data.stage === "followers" && typeof data.loaded === "number") {
        state.followersLoaded = data.loaded;
      }
      if (data.stage === "following" && typeof data.loaded === "number") {
        state.followingLoaded = data.loaded;
      }
      if (typeof data.followersCount === "number") {
        state.followersLoaded = data.followersCount;
      }
      state.progressPct = Math.max(
        state.progressPct,
        estimateProgress(data.stage, data.loaded, data.followersCount)
      );
      renderChrome();
      renderTable();
      return;
    }

    if (data.type === "error") {
      state.scanning = false;
      state.error = data.message || "Something went wrong.";
      state.status = "Scan failed.";
      state.progressPct = 0;
      renderAll();
      return;
    }

    if (data.type === "result") {
      state.scanning = false;
      state.viewer = data.viewer;
      state.followers = data.followers || [];
      state.following = data.following || [];
      state.followersLoaded = state.followers.length;
      state.followingLoaded = state.following.length;
      state.progressPct = 100;
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

  function hasResults() {
    return Boolean(state.comparison);
  }

  function renderChrome() {
    ensureUi();
    var ready = hasResults();
    refs.actions.classList.toggle("igfc-hidden", !ready);
    refs.status.classList.toggle("igfc-hidden", !ready && !state.scanning);
    refs.stats.classList.toggle("igfc-hidden", !ready);
    refs.searchRow.classList.toggle("igfc-hidden", !ready);
    renderSubfilters();
    refs.scanBtn.disabled = state.scanning;
    refs.exportBtn.disabled = !ready;
    refs.scanBtn.textContent = state.scanning ? "Scanning…" : "Scan my lists";
    refs.status.textContent = state.status;

    refs.progress.classList.toggle("igfc-hidden", !state.scanning);
    refs.progress.classList.toggle("igfc-progress-active", state.scanning);
    if (state.scanning) {
      refs.progressBar.style.width = Math.max(6, state.progressPct) + "%";
      refs.progressBar.classList.add("igfc-progress-fill");
    } else {
      refs.progressBar.style.width = "";
      refs.progressBar.classList.remove("igfc-progress-fill");
    }
  }

  function renderStats() {
    if (!hasResults()) {
      refs.stats.innerHTML = "";
      return;
    }

    var counts = state.comparison.counts;
    var items = [
      ["notFollowingBack", "Don't follow you", counts.notFollowingBack],
      ["notFollowedBack", "You don't follow", counts.notFollowedBack],
      ["mutual", "Follow back", counts.mutual],
      ["followers", "Followers", counts.followers],
      ["following", "Following", counts.following],
    ];

    refs.stats.innerHTML = "";
    items.forEach(function (item) {
      var card = el("button", "igfc-stat", {
        type: "button",
        "data-tab": item[0],
      });
      if (state.activeTab === item[0]) card.classList.add("igfc-active");
      card.appendChild(el("span", null, { text: item[1] }));
      card.appendChild(el("strong", null, { text: String(item[2]) }));
      card.addEventListener("click", function () {
        state.activeTab = item[0];
        if (item[0] !== "notFollowingBack") state.notFollowingFilter = "all";
        renderStats();
        renderSubfilters();
        renderTable();
      });
      refs.stats.appendChild(card);
    });
  }

  function renderSubfilters() {
    var show =
      hasResults() && state.activeTab === "notFollowingBack" && !state.scanning;
    refs.subfilters.classList.toggle("igfc-hidden", !show);
    if (!show) {
      refs.subfilters.innerHTML = "";
      return;
    }

    var counts = state.comparison.counts;
    var items = [
      ["all", "All", counts.notFollowingBack],
      ["verified", "Verified", counts.notFollowingVerified],
      ["unverified", "Not verified", counts.notFollowingUnverified],
    ];

    refs.subfilters.innerHTML = "";
    refs.subfilters.appendChild(
      el("span", "igfc-subfilters-label", { text: "Filter" })
    );

    items.forEach(function (item) {
      var btn = el("button", "igfc-subfilter", {
        type: "button",
        text: item[1] + " (" + item[2] + ")",
      });
      if (state.notFollowingFilter === item[0]) {
        btn.classList.add("igfc-active");
      }
      btn.addEventListener("click", function () {
        state.notFollowingFilter = item[0];
        renderSubfilters();
        renderTable();
      });
      refs.subfilters.appendChild(btn);
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

  function renderHeroScan() {
    var wrap = el("div", "igfc-hero");
    wrap.appendChild(
      el("p", "igfc-hero-copy", {
        text: "Load your followers and following from this logged-in session.",
      })
    );
    var heroBtn = el("button", "igfc-btn igfc-btn-primary igfc-hero-btn", {
      type: "button",
      text: "Scan my lists",
    });
    heroBtn.addEventListener("click", startScan);
    wrap.appendChild(heroBtn);
    refs.body.appendChild(wrap);
  }

  function renderScanning() {
    var wrap = el("div", "igfc-hero igfc-loading");
    var spinner = el("div", "igfc-spinner");
    spinner.appendChild(el("span"));
    wrap.appendChild(spinner);

    wrap.appendChild(
      el("h2", "igfc-loading-title", { text: "Scanning your lists" })
    );
    wrap.appendChild(
      el("p", "igfc-hero-copy", {
        text: state.status || "Working…",
      })
    );

    var meters = el("div", "igfc-load-meters");
    var f = el("div", "igfc-load-meter");
    f.appendChild(el("span", null, { text: "Followers" }));
    f.appendChild(
      el("strong", null, {
        text: String(state.followersLoaded || 0),
      })
    );
    var g = el("div", "igfc-load-meter");
    g.appendChild(el("span", null, { text: "Following" }));
    g.appendChild(
      el("strong", null, {
        text: String(state.followingLoaded || 0),
      })
    );
    meters.appendChild(f);
    meters.appendChild(g);
    wrap.appendChild(meters);

    var track = el("div", "igfc-load-track");
    var fill = el("div", "igfc-load-fill");
    fill.style.width = Math.max(6, state.progressPct) + "%";
    track.appendChild(fill);
    wrap.appendChild(track);

    refs.body.appendChild(wrap);
  }

  function renderTable() {
    refs.body.innerHTML = "";
    var centered = state.scanning || Boolean(state.error) || !state.comparison;
    refs.body.classList.toggle("igfc-body-center", centered);

    if (state.scanning) {
      renderScanning();
      return;
    }

    if (state.error) {
      var errWrap = el("div", "igfc-hero");
      errWrap.appendChild(el("div", "igfc-error", { text: state.error }));
      var retry = el("button", "igfc-btn igfc-btn-primary igfc-hero-btn", {
        type: "button",
        text: "Try again",
      });
      retry.addEventListener("click", startScan);
      errWrap.appendChild(retry);
      refs.body.appendChild(errWrap);
      return;
    }

    if (!state.comparison) {
      renderHeroScan();
      return;
    }

    var list;
    if (state.activeTab === "followers") list = state.followers;
    else if (state.activeTab === "following") list = state.following;
    else if (
      state.activeTab === "notFollowingBack" &&
      state.notFollowingFilter === "verified"
    ) {
      list = state.comparison.notFollowingVerified;
    } else if (
      state.activeTab === "notFollowingBack" &&
      state.notFollowingFilter === "unverified"
    ) {
      list = state.comparison.notFollowingUnverified;
    } else list = currentList();

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
      var nameRow = el("div", "igfc-name-row");
      var link = el("a", null, {
        href: "https://www.instagram.com/" + user.username + "/",
        target: "_blank",
        rel: "noopener noreferrer",
        text: "@" + user.username,
      });
      nameRow.appendChild(link);
      if (user.is_verified) {
        nameRow.appendChild(
          el("span", "igfc-verified", {
            title: "Verified account",
            text: "✓",
          })
        );
      }
      textWrap.appendChild(nameRow);
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
    renderSubfilters();
    renderTable();
  }

  function csvEscape(value) {
    var s = String(value == null ? "" : value);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCsv() {
    if (!state.comparison) return;
    var rows = [
      ["category", "username", "full_name", "verified", "profile_url"],
    ];
    function add(category, list) {
      list.forEach(function (u) {
        rows.push([
          category,
          u.username,
          u.full_name || "",
          u.is_verified ? "yes" : "no",
          "https://www.instagram.com/" + u.username + "/",
        ]);
      });
    }
    add("mutual", state.comparison.mutual);
    add(
      "not_following_back_verified",
      state.comparison.notFollowingVerified
    );
    add(
      "not_following_back_unverified",
      state.comparison.notFollowingUnverified
    );
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
