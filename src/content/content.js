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
    verifiedFilter: "all",
    query: "",
    // Whose lists are shown: { username, userId, isSelf, followerCount, ... }.
    account: null,
    // Username being scanned ("" = your own lists) while a scan runs.
    scanUsername: "",
    followers: [],
    following: [],
    comparison: null,
    status: "Ready",
    error: "",
    pendingActions: {},
    scanStage: "",
    followersLoaded: 0,
    followingLoaded: 0,
    followersDone: false,
    followingDone: false,
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

  function activeBaseList() {
    if (!state.comparison) return [];
    if (state.activeTab === "followers") return state.followers;
    if (state.activeTab === "following") return state.following;
    return state.comparison[state.activeTab] || [];
  }

  function filteredByVerified(list) {
    if (state.verifiedFilter === "verified") {
      return list.filter(function (u) {
        return Boolean(u.is_verified);
      });
    }
    if (state.verifiedFilter === "unverified") {
      return list.filter(function (u) {
        return !u.is_verified;
      });
    }
    return list;
  }

  function getVisibleList() {
    var list = filteredByVerified(activeBaseList());
    if (!state.query) return list;
    return list.filter(function (u) {
      return (
        u.username.toLowerCase().indexOf(state.query) !== -1 ||
        (u.full_name || "").toLowerCase().indexOf(state.query) !== -1
      );
    });
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
      title: "Follow Check for Instagram",
      "aria-label": "Open Follow Check",
    });
    fab.appendChild(
      el("img", "igfc-fab-icon", {
        src: chrome.runtime.getURL("icons/icon128.png"),
        alt: "",
        draggable: "false",
      })
    );
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
    var title = el("h1", "igfc-title", { text: "Follow Check for Instagram" });
    var status = el("div", "igfc-status");
    titleWrap.appendChild(title);
    titleWrap.appendChild(status);
    header.appendChild(titleWrap);

    // Stays in the header next to the results, so you can check someone else
    // without going back to the start screen.
    var headerCheck = buildCheckForm(
      "igfc-header-check",
      "Check another account",
      function () {
        state.status = "Enter an Instagram username, like natgeo.";
        renderChrome();
      }
    );

    var actions = el("div", "igfc-actions");
    var scanBtn = el("button", "igfc-btn igfc-btn-primary", {
      type: "button",
      text: "Scan my lists",
    });
    scanBtn.addEventListener("click", function () {
      startScan("");
    });
    var exportBtn = el("button", "igfc-btn", {
      type: "button",
      text: "Export CSV",
    });
    exportBtn.addEventListener("click", exportCsv);
    actions.appendChild(headerCheck);
    actions.appendChild(scanBtn);
    actions.appendChild(exportBtn);

    var closeBtn = el("button", "igfc-close", { type: "button", text: "×" });
    closeBtn.addEventListener("click", function () {
      setOpen(false);
    });

    header.appendChild(actions);
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

    var notice = el("div", "igfc-notice igfc-hidden");

    var body = el("div", "igfc-body");

    panel.appendChild(header);
    panel.appendChild(progress);
    panel.appendChild(stats);
    panel.appendChild(subfilters);
    panel.appendChild(searchRow);
    panel.appendChild(notice);
    panel.appendChild(body);

    root.appendChild(fab);
    root.appendChild(backdrop);
    root.appendChild(panel);
    document.documentElement.appendChild(root);

    refs = {
      fab: fab,
      backdrop: backdrop,
      panel: panel,
      title: title,
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
      notice: notice,
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

  function normalizeUsername(raw) {
    var value = String(raw || "").trim();
    var fromUrl = value.match(/instagram\.com\/([^/?#\s]+)/i);
    if (fromUrl) value = fromUrl[1];
    value = value.replace(/^@+/, "").toLowerCase();
    return /^[a-z0-9._]{1,30}$/.test(value) ? value : "";
  }

  function isOwnLists() {
    return !state.account || Boolean(state.account.isSelf);
  }

  // "" for your own lists, otherwise the checked username; null before any scan.
  function shownUsername() {
    if (!state.comparison || !state.account) return null;
    return state.account.isSelf ? "" : state.account.username.toLowerCase();
  }

  function startScan(username) {
    username = username || "";
    // Same scan already running: nothing to do. A different one replaces it.
    if (state.scanning && state.scanUsername === username) return;
    injectBridge();
    if (shownUsername() !== username) {
      // Different account: its old results would only mislead.
      state.comparison = null;
      state.followers = [];
      state.following = [];
      state.account = null;
      state.activeTab = "notFollowingBack";
      state.verifiedFilter = "all";
      state.query = "";
      if (refs.search) refs.search.value = "";
    }
    state.scanning = true;
    state.scanUsername = username;
    state.error = "";
    state.status = username ? "Looking up @" + username + "…" : "Connecting…";
    state.scanStage = "viewer";
    state.followersLoaded = 0;
    state.followingLoaded = 0;
    state.followersDone = false;
    state.followingDone = false;
    state.progressPct = 4;
    state.requestId += 1;
    var requestId = state.requestId;
    renderAll();

    setTimeout(function () {
      postToBridge({ type: "scan", requestId: requestId, username: username });
    }, 60);
  }

  // followers + following as the profile reports them, or 0 if unknown.
  function knownTotal(account) {
    if (!account || account.followerCount == null || account.followingCount == null) {
      return 0;
    }
    return account.followerCount + account.followingCount;
  }

  function estimateProgress(stage, data) {
    if (stage === "viewer") return 8;
    if (stage === "lists") {
      var followers = (data && data.followersLoaded) || 0;
      var following = (data && data.followingLoaded) || 0;
      var total = knownTotal(data && data.account);
      // With the profile's totals we can show real progress.
      if (total > 0) {
        return Math.min(99, Math.floor(((followers + following) / total) * 100));
      }
      return Math.min(
        96,
        12 + Math.floor(followers / 6) + Math.floor(following / 6)
      );
    }
    if (stage === "followers") {
      return Math.min(48, 12 + Math.floor(((data && data.loaded) || 0) / 8));
    }
    if (stage === "following") {
      return Math.min(96, 52 + Math.floor(((data && data.loaded) || 0) / 8));
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

      // Only update local lists after Instagram confirmed the change.
      applyFriendshipLocally(data.action, data.userId, data.username);
      state.status =
        data.action === "destroy"
          ? "Removed @" + data.username + " on Instagram"
          : "Followed @" + data.username + " on Instagram";
      renderAll();
      return;
    }

    if (data.requestId && data.requestId !== state.requestId) return;

    if (data.type === "progress") {
      state.status = data.message || "Working…";
      if (data.account) state.account = data.account;
      if (data.stage) state.scanStage = data.stage;
      if (typeof data.followersLoaded === "number") {
        state.followersLoaded = data.followersLoaded;
      } else if (data.stage === "followers" && typeof data.loaded === "number") {
        state.followersLoaded = data.loaded;
      }
      if (typeof data.followingLoaded === "number") {
        state.followingLoaded = data.followingLoaded;
      } else if (data.stage === "following" && typeof data.loaded === "number") {
        state.followingLoaded = data.loaded;
      }
      if (typeof data.followersDone === "boolean") {
        state.followersDone = data.followersDone;
      }
      if (typeof data.followingDone === "boolean") {
        state.followingDone = data.followingDone;
      }
      if (typeof data.followersCount === "number") {
        state.followersLoaded = data.followersCount;
      }
      state.progressPct = Math.max(
        state.progressPct,
        estimateProgress(data.stage, data)
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
      state.account = data.account;
      state.followers = data.followers || [];
      state.following = data.following || [];
      state.followersLoaded = state.followers.length;
      state.followingLoaded = state.following.length;
      state.progressPct = 100;
      state.comparison = compareLists(state.followers, state.following);
      state.status =
        "Done for @" +
        (state.account && state.account.username
          ? state.account.username
          : "you") +
        ".";
      state.error = "";
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

  function formatNumber(n) {
    return Number(n).toLocaleString("en-US");
  }

  // Instagram can hand back fewer people than a profile's counts say (hidden or
  // deactivated accounts, or it stopped paging). Say so when the gap is real.
  function incompleteListsNotice() {
    var account = state.account;
    if (!hasResults() || state.scanning || !account || account.isSelf) return "";
    var gaps = [];
    [
      ["followers", state.followers.length, account.followerCount],
      ["following", state.following.length, account.followingCount],
    ].forEach(function (item) {
      var loaded = item[1];
      var reported = item[2];
      if (reported == null) return;
      if (reported - loaded > Math.max(5, reported * 0.05)) {
        gaps.push(formatNumber(loaded) + " of " + formatNumber(reported) + " " + item[0]);
      }
    });
    if (!gaps.length) return "";
    return (
      "Instagram only returned " +
      gaps.join(" and ") +
      " for @" +
      account.username +
      ", so these lists may be incomplete."
    );
  }

  function renderChrome() {
    ensureUi();
    var ready = hasResults();
    refs.title.textContent =
      ready && !isOwnLists()
        ? "Follow Check · @" + state.account.username
        : "Follow Check for Instagram";
    refs.actions.classList.toggle("igfc-hidden", !ready);
    // While scanning, the loader in the body already says what's happening.
    refs.status.classList.toggle("igfc-hidden", !ready || state.scanning);
    refs.stats.classList.toggle("igfc-hidden", !ready);
    refs.searchRow.classList.toggle("igfc-hidden", !ready);
    renderSubfilters();
    var notice = incompleteListsNotice();
    refs.notice.textContent = notice;
    refs.notice.classList.toggle("igfc-hidden", !notice);
    refs.scanBtn.disabled = state.scanning;
    refs.exportBtn.disabled = !ready;
    refs.scanBtn.textContent = state.scanning ? "Scanning…" : "Scan my lists";
    refs.status.textContent = state.status;

    refs.progress.classList.toggle("igfc-hidden", !state.scanning);
    refs.progressBar.style.width = state.scanning
      ? Math.max(4, state.progressPct) + "%"
      : "";
  }

  function renderStats() {
    if (!hasResults()) {
      refs.stats.innerHTML = "";
      return;
    }

    var counts = state.comparison.counts;
    var who = isOwnLists() ? "" : "@" + state.account.username;
    var items = [
      [
        "notFollowingBack",
        who ? "Don't follow " + who + " back" : "Don't follow you",
        counts.notFollowingBack,
      ],
      [
        "notFollowedBack",
        who ? who + " doesn't follow back" : "You don't follow",
        counts.notFollowedBack,
      ],
      ["mutual", who ? "Mutuals" : "Follow back", counts.mutual],
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
        renderStats();
        renderSubfilters();
        renderTable();
      });
      refs.stats.appendChild(card);
    });
  }

  function renderSubfilters() {
    var show = hasResults() && !state.scanning;
    refs.subfilters.classList.toggle("igfc-hidden", !show);
    if (!show) {
      refs.subfilters.innerHTML = "";
      return;
    }

    var base = activeBaseList();
    var verifiedCount = 0;
    var unverifiedCount = 0;
    for (var i = 0; i < base.length; i++) {
      if (base[i].is_verified) verifiedCount += 1;
      else unverifiedCount += 1;
    }

    var items = [
      ["all", "All", base.length],
      ["verified", "Verified", verifiedCount],
      ["unverified", "Not verified", unverifiedCount],
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
      if (state.verifiedFilter === item[0]) {
        btn.classList.add("igfc-active");
      }
      btn.addEventListener("click", function () {
        state.verifiedFilter = item[0];
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

  function userKey(user) {
    return (user && user.username ? user.username : "").toLowerCase();
  }

  function isInList(list, user) {
    var key = userKey(user);
    if (!key) return false;
    for (var i = 0; i < list.length; i++) {
      if (userKey(list[i]) === key) return true;
    }
    return false;
  }

  function makeRemoveButton(user) {
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

  function makeFollowButton(user) {
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

  function actionButtonFor(user) {
    var youFollow = isInList(state.following, user);
    var theyFollow = isInList(state.followers, user);

    // You follow them → unfollow
    if (youFollow) return makeRemoveButton(user);
    // They follow you, you don't → follow back
    if (theyFollow) return makeFollowButton(user);
    return null;
  }

  function buildCheckForm(className, placeholder, onInvalid) {
    var form = el("form", "igfc-check-form " + className, { novalidate: "" });
    var field = el("label", "igfc-check-field");
    field.appendChild(el("span", "igfc-check-at", { text: "@" }));
    var input = el("input", "igfc-check-input", {
      type: "text",
      placeholder: placeholder,
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      maxlength: "100",
      "aria-label": "Instagram username to check",
    });
    field.appendChild(input);
    form.appendChild(field);
    form.appendChild(el("button", "igfc-btn", { type: "submit", text: "Check" }));
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var username = normalizeUsername(input.value);
      if (!username) {
        onInvalid();
        input.focus();
        return;
      }
      input.value = "";
      startScan(username);
    });
    return form;
  }

  function renderCheckForm() {
    var hint = el("p", "igfc-check-hint", {
      text: "Works for public accounts, and private ones you follow.",
    });
    var form = buildCheckForm("", "username", function () {
      hint.textContent = "Enter an Instagram username, like natgeo.";
      hint.classList.add("igfc-check-hint-error");
    });
    var wrap = el("div", "igfc-check");
    wrap.appendChild(form);
    wrap.appendChild(hint);
    return wrap;
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
    heroBtn.addEventListener("click", function () {
      startScan("");
    });
    wrap.appendChild(heroBtn);
    wrap.appendChild(
      el("p", "igfc-hero-divider", { text: "or check another account" })
    );
    wrap.appendChild(renderCheckForm());
    wrap.appendChild(
      el("p", "igfc-hero-disclosure", {
        text: "By scanning, you allow this unofficial extension to read follower and following lists (yours, or the account you check) from your existing Instagram session. The comparison runs only in this tab: nothing is sent to the developer or saved after you close it. No passwords are collected. Not affiliated with Instagram or Meta.",
      })
    );
    refs.body.appendChild(wrap);
  }

  var SVG_NS = "http://www.w3.org/2000/svg";
  var RING_RADIUS = 52;
  var RING_LENGTH = 2 * Math.PI * RING_RADIUS;
  var loader = null;

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  function buildLoaderMeter(label) {
    var card = el("div", "igfc-load-meter");
    var head = el("div", "igfc-load-meter-head");
    head.appendChild(el("span", "igfc-load-label", { text: label }));
    var tag = el("span", "igfc-load-tag");
    head.appendChild(tag);
    var value = el("div", "igfc-load-value");
    var count = el("strong");
    var total = el("small");
    value.appendChild(count);
    value.appendChild(total);
    var bar = el("div", "igfc-load-bar");
    var fill = document.createElement("i");
    bar.appendChild(fill);
    card.appendChild(head);
    card.appendChild(value);
    card.appendChild(bar);
    return { card: card, tag: tag, count: count, total: total, bar: bar, fill: fill };
  }

  function buildLoader() {
    var wrap = el("div", "igfc-loader");

    var ring = el("div", "igfc-loader-ring");
    var svg = svgEl("svg", { viewBox: "0 0 120 120", "aria-hidden": "true" });
    var defs = svgEl("defs", {});
    var gradient = svgEl("linearGradient", {
      id: "igfc-ring-gradient",
      x1: "0",
      y1: "0",
      x2: "1",
      y2: "1",
    });
    [
      ["0%", "#feda75"],
      ["35%", "#fa7e1e"],
      ["65%", "#d62976"],
      ["100%", "#962fbf"],
    ].forEach(function (stop) {
      gradient.appendChild(
        svgEl("stop", { offset: stop[0], "stop-color": stop[1] })
      );
    });
    defs.appendChild(gradient);
    svg.appendChild(defs);
    svg.appendChild(
      svgEl("circle", { class: "igfc-ring-track", cx: "60", cy: "60", r: RING_RADIUS })
    );
    var arc = svgEl("circle", {
      class: "igfc-ring-arc",
      cx: "60",
      cy: "60",
      r: RING_RADIUS,
      "stroke-dasharray": RING_LENGTH.toFixed(2),
      "stroke-dashoffset": RING_LENGTH.toFixed(2),
    });
    svg.appendChild(arc);
    ring.appendChild(svg);
    ring.appendChild(
      el("img", "igfc-loader-logo", {
        src: chrome.runtime.getURL("icons/icon128.png"),
        alt: "",
      })
    );
    var pct = el("span", "igfc-loader-pct");
    ring.appendChild(pct);
    wrap.appendChild(ring);

    var title = el("h2", "igfc-loading-title");
    var sub = el("p", "igfc-loader-sub");
    wrap.appendChild(title);
    wrap.appendChild(sub);

    var meters = el("div", "igfc-load-meters");
    var followers = buildLoaderMeter("Followers");
    var following = buildLoaderMeter("Following");
    meters.appendChild(followers.card);
    meters.appendChild(following.card);
    wrap.appendChild(meters);

    wrap.appendChild(
      el("p", "igfc-loader-foot", {
        text: "Keep this tab open. Big lists can take a minute.",
      })
    );

    return {
      root: wrap,
      arc: arc,
      pct: pct,
      title: title,
      sub: sub,
      followers: followers,
      following: following,
    };
  }

  function updateLoaderMeter(meter, loaded, total, done, waiting) {
    meter.count.textContent = formatNumber(loaded || 0);
    meter.total.textContent = total != null ? " / " + formatNumber(total) : "";
    meter.tag.textContent = done ? "✓ Done" : waiting ? "Waiting" : "Loading";
    meter.tag.classList.toggle("igfc-done", done);
    meter.tag.classList.toggle("igfc-waiting", waiting && !done);
    var known = total != null && total > 0;
    meter.bar.classList.toggle("igfc-indeterminate", !done && !known && !waiting);
    meter.fill.style.width = done
      ? "100%"
      : known
        ? Math.min(100, ((loaded || 0) / total) * 100) + "%"
        : "0%";
  }

  function renderScanning() {
    if (!loader) loader = buildLoader();
    if (loader.root.parentNode !== refs.body) {
      refs.body.innerHTML = "";
      refs.body.appendChild(loader.root);
    }

    var account = state.account || {};
    var listing = state.scanStage === "lists";
    var total = knownTotal(account);
    var determinate = listing && total > 0;
    var ratio = determinate
      ? Math.min(0.99, (state.followersLoaded + state.followingLoaded) / total)
      : 0.28;

    loader.root.classList.toggle("igfc-loader-indeterminate", !determinate);
    loader.arc.setAttribute(
      "stroke-dashoffset",
      (RING_LENGTH * (1 - ratio)).toFixed(2)
    );
    loader.pct.textContent = Math.round(ratio * 100) + "%";

    var who = state.scanUsername ? "@" + state.scanUsername : "";
    loader.title.textContent = who ? "Checking " + who : "Scanning your lists";
    loader.sub.textContent = !listing
      ? who
        ? "Looking up " + who + "…"
        : "Connecting to your Instagram…"
      : state.followersDone && state.followingDone
        ? "Comparing lists…"
        : "Loading followers and following…";

    updateLoaderMeter(
      loader.followers,
      state.followersLoaded,
      account.followerCount,
      state.followersDone,
      !listing
    );
    updateLoaderMeter(
      loader.following,
      state.followingLoaded,
      account.followingCount,
      state.followingDone,
      !listing
    );
  }

  function renderTable() {
    var centered = state.scanning || Boolean(state.error) || !state.comparison;
    refs.body.classList.toggle("igfc-body-center", centered);

    // The loader updates in place (not rebuilt) so its ring and bars animate.
    if (state.scanning) {
      renderScanning();
      return;
    }
    refs.body.innerHTML = "";

    if (state.error) {
      var errWrap = el("div", "igfc-hero");
      errWrap.appendChild(el("div", "igfc-error", { text: state.error }));
      var errActions = el("div", "igfc-hero-actions");
      var retry = el("button", "igfc-btn igfc-btn-primary igfc-hero-btn", {
        type: "button",
        text: "Try again",
      });
      retry.addEventListener("click", function () {
        startScan(state.scanUsername);
      });
      var back = el("button", "igfc-btn igfc-hero-btn", {
        type: "button",
        text: "Back",
      });
      back.addEventListener("click", function () {
        state.error = "";
        state.status = "Ready";
        renderAll();
      });
      errActions.appendChild(retry);
      errActions.appendChild(back);
      errWrap.appendChild(errActions);
      refs.body.appendChild(errWrap);
      return;
    }

    if (!state.comparison) {
      renderHeroScan();
      return;
    }

    var list = getVisibleList();

    if (!list.length) {
      refs.body.appendChild(
        el("div", "igfc-empty", { text: "No people in this list." })
      );
      return;
    }

    // Follow/unfollow only makes sense for your own lists, not someone you checked.
    var showActions = isOwnLists();
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
    // Display names come from other people; stop spreadsheets running them as formulas.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCsv() {
    if (!state.comparison) return;
    var rows = [["category", "username", "full_name", "verified", "profile_url"]];
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
    add("not_following_back", state.comparison.notFollowingBack);
    add("not_followed_back", state.comparison.notFollowedBack);
    add("followers", state.followers);
    add("following", state.following);

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
      ((state.account && state.account.username) || "me") +
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
      // From the popup's username box: check that account straight away.
      var username = normalizeUsername(message.username);
      if (username) startScan(username);
      sendResponse({ ok: true });
      return false;
    }
    if (message && message.type === "IGFC_STATUS") {
      sendResponse({
        ok: true,
        scanning: state.scanning,
        hasResult: Boolean(state.comparison),
        account: state.account,
        counts: state.comparison && state.comparison.counts,
      });
      return false;
    }
    return false;
  });

  // Boot floating icon button on Instagram pages
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
