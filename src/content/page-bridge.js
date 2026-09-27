/**
 * Runs in Instagram's page context so fetch uses the logged-in session cookies.
 * Talks to the content script via window.postMessage.
 */
(function () {
  // Same ?v= the content script appends (the manifest version), so it can't go stale.
  var BRIDGE_VERSION =
    (document.currentScript &&
      new URL(document.currentScript.src).searchParams.get("v")) ||
    "dev";
  var SOURCE = "ig-follow-check-bridge";
  var APP_ID = "936619743392459";

  // Replace handler on updates so extension reloads pick up new bridge code.
  if (!window.__IGFC_BRIDGE_LISTENING__) {
    window.__IGFC_BRIDGE_LISTENING__ = true;
    window.addEventListener("message", function (event) {
      if (typeof window.__IGFC_BRIDGE_ON_MESSAGE === "function") {
        window.__IGFC_BRIDGE_ON_MESSAGE(event);
      }
    });
  }

  if (window.__IGFC_BRIDGE_VERSION__ === BRIDGE_VERSION) return;
  window.__IGFC_BRIDGE_VERSION__ = BRIDGE_VERSION;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function getCookie(name) {
    var match = document.cookie.match(
      new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)")
    );
    return match ? decodeURIComponent(match[1]) : "";
  }

  function igHeaders(extra) {
    var csrf = getCookie("csrftoken");
    if (!csrf) {
      throw new Error(
        "Missing CSRF token. Refresh Instagram and make sure you are logged in."
      );
    }
    var headers = {
      Accept: "*/*",
      "X-CSRFToken": csrf,
      "X-IG-App-ID": APP_ID,
      "X-Requested-With": "XMLHttpRequest",
      "X-ASBD-ID": "129477",
      "X-Instagram-AJAX": "1",
      Origin: "https://www.instagram.com",
      Referer: "https://www.instagram.com/",
    };
    if (extra) {
      Object.keys(extra).forEach(function (key) {
        headers[key] = extra[key];
      });
    }
    return headers;
  }

  async function igFetch(url, options) {
    options = options || {};
    var res = await fetch(url, {
      method: options.method || "GET",
      credentials: "include",
      headers: igHeaders(options.headers),
      body: options.body,
      redirect: "follow",
    });

    var text = "";
    try {
      text = await res.text();
    } catch (_) {}

    var data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = null;
      }
    }

    // Rate limits and action blocks: surface them so callers stop instead of retrying.
    var igMessage = (data && (data.message || data.feedback_message)) || "";
    if (
      res.status === 429 ||
      (data && data.spam) ||
      /wait a few minutes|try again later|too many requests/i.test(igMessage)
    ) {
      var limitError = new Error(
        ((data && (data.feedback_message || data.message)) ||
          "Instagram is limiting requests right now. Wait a few minutes, then try again.") +
          " (HTTP " +
          res.status +
          ")"
      );
      limitError.rateLimited = true;
      throw limitError;
    }

    if (!res.ok) {
      var snippet = text ? ": " + text.slice(0, 160) : "";
      throw new Error("HTTP " + res.status + " for " + url + snippet);
    }

    if (
      data &&
      (data.status === "fail" ||
        data.message === "checkpoint_required" ||
        data.spam ||
        data.require_login)
    ) {
      throw new Error(
        data.message ||
          data.feedback_message ||
          "Instagram rejected the request (" + (data.status || "fail") + ")"
      );
    }

    // Prefer real JSON. Empty/non-JSON success bodies are treated as unknown.
    return data == null
      ? { __raw: text, __empty: !text, __url: res.url, __redirected: res.redirected }
      : data;
  }

  // Short, human-readable reason for a failed count lookup (shown in the panel).
  function describeCountsFailure(err, response) {
    if (err) {
      return String((err && err.message) || err).replace(
        / for https:\/\/\S+?(?=: |$)/,
        ""
      );
    }
    if (response && response.__redirected && /\/accounts\/login\//.test(response.__url)) {
      return "Instagram redirected to its login page";
    }
    if (response && response.__raw != null) {
      return response.__empty ? "empty response" : "got a web page instead of data";
    }
    return "no follower counts in the response";
  }

  function pickProfilePic(u) {
    if (!u) return "";
    if (u.profile_pic_url) return u.profile_pic_url;
    if (u.profile_pic_url_hd) return u.profile_pic_url_hd;
    if (u.hd_profile_pic_url_info && u.hd_profile_pic_url_info.url) {
      return u.hd_profile_pic_url_info.url;
    }
    if (
      u.hd_profile_pic_versions &&
      u.hd_profile_pic_versions.length &&
      u.hd_profile_pic_versions[0].url
    ) {
      return u.hd_profile_pic_versions[0].url;
    }
    return "";
  }

  function normalizeUser(u) {
    return {
      username: u.username,
      full_name: u.full_name || u.fullName || "",
      profile_pic_url: pickProfilePic(u),
      pk: String(u.pk || u.id || u.pk_id || ""),
      is_private: Boolean(u.is_private),
      is_verified: Boolean(u.is_verified),
    };
  }

  async function getFriendshipStatus(userId) {
    var data = await igFetch(
      "https://www.instagram.com/api/v1/friendships/show/" + userId + "/"
    );
    return data && (data.friendship_status || data);
  }

  function readFriendshipFlags(status) {
    if (!status) return null;
    var src =
      status.friendship_status && typeof status.friendship_status === "object"
        ? status.friendship_status
        : status;
    if (typeof src.following !== "boolean" && typeof src.outgoing_request !== "boolean") {
      return null;
    }
    return {
      following: Boolean(src.following),
      outgoing_request: Boolean(src.outgoing_request),
    };
  }

  async function friendshipAction(userId, action) {
    // action: "create" (follow) | "destroy" (unfollow)
    if (!userId) throw new Error("Missing user id for friendship action.");
    if (action !== "create" && action !== "destroy") {
      throw new Error("Invalid friendship action.");
    }

    var body = new URLSearchParams({
      user_id: String(userId),
      container_module: "profile",
    }).toString();

    var apiUrl =
      "https://www.instagram.com/api/v1/friendships/" +
      action +
      "/" +
      userId +
      "/";

    var webAction = action === "destroy" ? "unfollow" : "follow";
    var webUrl =
      "https://www.instagram.com/web/friendships/" + userId + "/" + webAction + "/";

    var lastError = null;
    var data = null;

    try {
      data = await igFetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body,
      });
    } catch (err) {
      if (err && err.rateLimited) throw err;
      lastError = err;
    }

    // Fallback to legacy web friendship endpoint if API v1 did not confirm.
    var flags = readFriendshipFlags(data);
    var apiLooksOk =
      data &&
      !data.__empty &&
      (data.status === "ok" ||
        flags != null ||
        data.result === "following" ||
        data.result === "requested" ||
        (data.friendship_status && typeof data.friendship_status === "object"));

    if (!apiLooksOk) {
      try {
        data = await igFetch(webUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body,
        });
        flags = readFriendshipFlags(data);
        apiLooksOk =
          data &&
          !data.__empty &&
          (data.status === "ok" ||
            flags != null ||
            data.result === "following" ||
            data.result === "requested");
      } catch (err) {
        if (err && err.rateLimited) throw err;
        lastError = err;
      }
    }

    // Hard verify against Instagram before telling the UI it worked.
    await sleep(300);
    var verified = null;
    try {
      verified = readFriendshipFlags(await getFriendshipStatus(userId));
    } catch (_) {
      verified = flags;
    }

    if (action === "destroy") {
      if (verified && verified.following) {
        throw new Error(
          "Instagram still shows you as following this account. Try again in a moment."
        );
      }
      if ((!verified || verified.following !== false) && !apiLooksOk) {
        throw (
          lastError ||
          new Error("Unfollow was not confirmed by Instagram.")
        );
      }
    }

    if (action === "create") {
      var followedOrRequested =
        verified && (verified.following || verified.outgoing_request);
      if (verified && !followedOrRequested) {
        throw new Error(
          "Instagram still shows you as not following this account. Try again in a moment."
        );
      }
      if (!followedOrRequested && !apiLooksOk) {
        throw (
          lastError ||
          new Error("Follow was not confirmed by Instagram.")
        );
      }
    }

    return {
      status: "ok",
      action: action,
      userId: String(userId),
      following: verified ? verified.following : null,
      outgoing_request: verified ? verified.outgoing_request : null,
      raw: data,
    };
  }

  function extractCounts(user) {
    if (!user) return null;
    var followers =
      user.follower_count != null
        ? user.follower_count
        : user.edge_followed_by && user.edge_followed_by.count != null
          ? user.edge_followed_by.count
          : null;
    var following =
      user.following_count != null
        ? user.following_count
        : user.edge_follow && user.edge_follow.count != null
          ? user.edge_follow.count
          : null;
    if (followers == null && following == null) return null;
    return {
      follower_count: followers == null ? null : Number(followers),
      following_count: following == null ? null : Number(following),
      is_verified:
        user.is_verified != null ? Boolean(user.is_verified) : undefined,
    };
  }

  async function fetchUserCounts(userId, username) {
    // Same two lookups as before; we just keep each one's reason if it fails.
    var reasons = [];

    if (userId) {
      try {
        var info = await igFetch(
          "https://www.instagram.com/api/v1/users/" + userId + "/info/"
        );
        var fromInfo = extractCounts(info && info.user);
        if (fromInfo) return fromInfo;
        reasons.push("user info: " + describeCountsFailure(null, info));
      } catch (err) {
        reasons.push("user info: " + describeCountsFailure(err));
      }
    }

    if (username) {
      try {
        var profile = await igFetch(
          "https://www.instagram.com/api/v1/users/web_profile_info/?username=" +
            encodeURIComponent(username)
        );
        var fromProfile = extractCounts(
          profile && profile.data && profile.data.user
        );
        if (fromProfile) return fromProfile;
        reasons.push("profile info: " + describeCountsFailure(null, profile));
      } catch (err) {
        reasons.push("profile info: " + describeCountsFailure(err));
      }
    }

    throw new Error(
      reasons.join(" · ") || "Could not load counts for @" + (username || userId)
    );
  }

  async function resolveViewer() {
    var dsUserId = getCookie("ds_user_id");
    if (!dsUserId) {
      throw new Error(
        "Not logged in. Open Instagram in this tab and sign in, then try again."
      );
    }

    try {
      var editData = await igFetch(
        "https://www.instagram.com/api/v1/accounts/edit/web_form_data/"
      );
      var form = editData.form_data || editData;
      if (form && form.username) {
        return {
          userId: String(dsUserId),
          username: form.username,
          full_name: form.first_name || "",
        };
      }
    } catch (err) {
      if (err && err.rateLimited) throw err;
    }

    try {
      var infoData = await igFetch(
        "https://www.instagram.com/api/v1/users/" + dsUserId + "/info/"
      );
      var user = infoData && infoData.user;
      if (user && user.username) {
        return {
          userId: String(user.pk || dsUserId),
          username: user.username,
          full_name: user.full_name || "",
        };
      }
    } catch (err) {
      if (err && err.rateLimited) throw err;
    }

    var profileLink =
      document.querySelector(
        'a[href^="/"][href$="/"] img[alt$="profile picture"]'
      ) ||
      document.querySelector(
        'a[href*="/"] span img[alt*="profile picture"]'
      );
    var username = "";
    if (profileLink) {
      var a = profileLink.closest("a");
      var href = (a && a.getAttribute("href")) || "";
      var m = href.match(/^\/([^/]+)\/?$/);
      if (m) username = m[1];
    }
    if (!username) {
      throw new Error(
        "Could not detect your Instagram username. Open your profile once, then retry."
      );
    }
    return { userId: String(dsUserId), username: username, full_name: "" };
  }

  async function fetchFriendshipList(userId, kind, onProgress) {
    var collected = [];
    var seen = {};
    var maxId = null;
    var page = 0;

    do {
      page += 1;
      var params = new URLSearchParams({
        count: "200",
        search_surface: "follow_list_page",
      });
      if (maxId) params.set("max_id", maxId);

      var url =
        "https://www.instagram.com/api/v1/friendships/" +
        userId +
        "/" +
        kind +
        "/?" +
        params.toString();
      var data = await igFetch(url);
      var users = data.users || [];

      for (var i = 0; i < users.length; i++) {
        var norm = normalizeUser(users[i]);
        var key = norm.username.toLowerCase();
        if (!seen[key]) {
          seen[key] = true;
          collected.push(norm);
        }
      }

      var hasMore =
        Boolean(data.next_max_id) &&
        users.length > 0 &&
        String(data.next_max_id) !== String(maxId);

      if (onProgress) {
        onProgress({
          kind: kind,
          loaded: collected.length,
          page: page,
          hasMore: hasMore,
        });
      }

      maxId = hasMore ? String(data.next_max_id) : null;
      // Light pacing only — followers + following run as parallel workers.
      if (maxId) await sleep(60 + Math.floor(Math.random() * 80));
    } while (maxId);

    return collected;
  }

  function post(payload) {
    payload.source = SOURCE;
    window.postMessage(payload, "*");
  }

  async function runScan(requestId) {
    var viewer = await resolveViewer();
    post({
      type: "progress",
      requestId: requestId,
      stage: "viewer",
      message: "Signed in as @" + viewer.username,
      viewer: viewer,
    });

    var followersLoaded = 0;
    var followingLoaded = 0;

    function emitListsProgress() {
      post({
        type: "progress",
        requestId: requestId,
        stage: "lists",
        message:
          "Loading lists… " +
          followersLoaded +
          " followers, " +
          followingLoaded +
          " following",
        viewer: viewer,
        followersLoaded: followersLoaded,
        followingLoaded: followingLoaded,
        loaded: followersLoaded + followingLoaded,
      });
    }

    post({
      type: "progress",
      requestId: requestId,
      stage: "lists",
      message: "Loading followers and following in parallel…",
      viewer: viewer,
      followersLoaded: 0,
      followingLoaded: 0,
    });

    // Two workers: followers + following at the same time.
    // Pages inside each list stay sequential (Instagram cursor pagination).
    var lists = await Promise.all([
      fetchFriendshipList(viewer.userId, "followers", function (p) {
        followersLoaded = p.loaded;
        emitListsProgress();
      }),
      fetchFriendshipList(viewer.userId, "following", function (p) {
        followingLoaded = p.loaded;
        emitListsProgress();
      }),
    ]);

    var followers = lists[0];
    var following = lists[1];

    post({
      type: "result",
      requestId: requestId,
      viewer: viewer,
      followers: followers,
      following: following,
    });
  }

  window.__IGFC_BRIDGE_ON_MESSAGE = function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.source !== "ig-follow-check-content") return;

    if (data.type === "ping") {
      post({ type: "pong", requestId: data.requestId });
      return;
    }

    if (data.type === "scan") {
      runScan(data.requestId).catch(function (err) {
        post({
          type: "error",
          requestId: data.requestId,
          message: (err && err.message) || String(err),
        });
      });
      return;
    }

    if (data.type === "friendship") {
      friendshipAction(data.userId, data.action)
        .then(function (result) {
          post({
            type: "friendshipResult",
            requestId: data.requestId,
            ok: true,
            action: data.action,
            userId: data.userId,
            username: data.username,
            result: result,
          });
        })
        .catch(function (err) {
          post({
            type: "friendshipResult",
            requestId: data.requestId,
            ok: false,
            action: data.action,
            userId: data.userId,
            username: data.username,
            message: (err && err.message) || String(err),
          });
        });
      return;
    }

    if (data.type === "userCounts") {
      fetchUserCounts(data.userId, data.username)
        .then(function (counts) {
          post({
            type: "userCountsResult",
            requestId: data.requestId,
            ok: true,
            userId: data.userId,
            username: data.username,
            follower_count: counts.follower_count,
            following_count: counts.following_count,
            is_verified: counts.is_verified,
          });
        })
        .catch(function (err) {
          post({
            type: "userCountsResult",
            requestId: data.requestId,
            ok: false,
            userId: data.userId,
            username: data.username,
            message: (err && err.message) || String(err),
          });
        });
    }
  };

  post({ type: "ready" });
})();
