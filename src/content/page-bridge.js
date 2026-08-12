/**
 * Runs in Instagram's page context so fetch uses the logged-in session cookies.
 * Talks to the content script via window.postMessage.
 */
(function () {
  var BRIDGE_VERSION = "1.3.2";
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

  function igHeaders() {
    var csrf = getCookie("csrftoken");
    return {
      Accept: "*/*",
      "X-CSRFToken": csrf,
      "X-IG-App-ID": APP_ID,
      "X-Requested-With": "XMLHttpRequest",
      "X-ASBD-ID": "129477",
    };
  }

  async function igFetch(url, options) {
    options = options || {};
    var headers = igHeaders();
    if (options.headers) {
      Object.keys(options.headers).forEach(function (key) {
        headers[key] = options.headers[key];
      });
    }
    var res = await fetch(url, {
      method: options.method || "GET",
      credentials: "include",
      headers: headers,
      body: options.body,
    });
    if (!res.ok) {
      var text = "";
      try {
        text = await res.text();
      } catch (_) {}
      var snippet = text ? ": " + text.slice(0, 160) : "";
      throw new Error("HTTP " + res.status + " for " + url + snippet);
    }
    var contentType = res.headers.get("content-type") || "";
    if (contentType.indexOf("application/json") !== -1) return res.json();
    try {
      return await res.json();
    } catch (_) {
      return {};
    }
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

  async function friendshipAction(userId, action) {
    // action: "create" (follow) | "destroy" (unfollow)
    if (!userId) throw new Error("Missing user id for friendship action.");
    if (action !== "create" && action !== "destroy") {
      throw new Error("Invalid friendship action.");
    }
    var url =
      "https://www.instagram.com/api/v1/friendships/" +
      action +
      "/" +
      userId +
      "/";
    var data = await igFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
    return data;
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
    if (userId) {
      try {
        var info = await igFetch(
          "https://www.instagram.com/api/v1/users/" + userId + "/info/"
        );
        var fromInfo = extractCounts(info && info.user);
        if (fromInfo) return fromInfo;
      } catch (_) {}
    }

    if (username) {
      var profile = await igFetch(
        "https://www.instagram.com/api/v1/users/web_profile_info/?username=" +
          encodeURIComponent(username)
      );
      var fromProfile = extractCounts(
        profile && profile.data && profile.data.user
      );
      if (fromProfile) return fromProfile;
    }

    throw new Error("Could not load counts for @" + (username || userId));
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
    } catch (_) {}

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
    } catch (_) {}

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
        count: "50",
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
      if (maxId) await sleep(350 + Math.floor(Math.random() * 250));
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

    post({
      type: "progress",
      requestId: requestId,
      stage: "followers",
      message: "Loading followers…",
      viewer: viewer,
    });

    var followers = await fetchFriendshipList(
      viewer.userId,
      "followers",
      function (p) {
        post({
          type: "progress",
          requestId: requestId,
          stage: "followers",
          message: "Followers loaded: " + p.loaded,
          loaded: p.loaded,
          viewer: viewer,
        });
      }
    );

    post({
      type: "progress",
      requestId: requestId,
      stage: "following",
      message: "Loading following…",
      viewer: viewer,
      followersCount: followers.length,
    });

    var following = await fetchFriendshipList(
      viewer.userId,
      "following",
      function (p) {
        post({
          type: "progress",
          requestId: requestId,
          stage: "following",
          message: "Following loaded: " + p.loaded,
          loaded: p.loaded,
          viewer: viewer,
          followersCount: followers.length,
        });
      }
    );

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
