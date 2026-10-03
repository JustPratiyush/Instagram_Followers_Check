# Chrome Web Store submission kit

Everything you need to fill in the Developer Dashboard, field by field. Every answer below matches what the code in version **1.6.0** actually does. Reviewers check that these match, so update this file whenever the code changes.

---

## 0. Before you start (one-time)

1. **Privacy policy must be online.** Commit and push the `store/` folder, then enable GitHub Pages (Settings → Pages → Deploy from branch → `main` / `/ (root)`). After a minute or two, this URL should load:

   ```text
   https://justpratiyush.github.io/Instagram_Followers_Check/store/privacy-policy.html
   ```

2. **Create a test Instagram account for the reviewers.** Use a fresh account, never your personal one. It should follow a few accounts and have a few followers, so the lists aren't empty. Turn **off** two-factor authentication on it, because reviewers can't receive your codes.
3. **2-Step Verification** must be on for the Google account you publish with (myaccount.google.com → Security). You can't publish without it.

---

## 1. Register the developer account (one-time, US$5)

1. Go to https://chrome.google.com/webstore/devconsole and sign in with the Google account you want to publish from. **The account email can't be changed later.**
2. Accept the developer agreement and pay the **one-time US$5** registration fee. There's no yearly renewal.
   - It's charged in USD, which your bank treats as an international transaction. At roughly ₹96/US$ that's about ₹480, plus your bank's forex markup, so around ₹500.
   - Use a Visa or Mastercard debit or credit card with **international / online transactions enabled** in your bank app. This is the most common reason the payment fails for Indian cards.
3. **Account** tab:
   - **Publisher name:** shown under the extension name (for example, your name).
   - **Contact email:** must be verified. Click the link in the verification email.
   - **Trader / Non-trader:** choose **Non-trader**. This is a free hobby project with no monetisation. Traders must publish their address and phone number to EU users.

---

## 2. Build the upload ZIP

From the repo root:

```bash
sh store/sync-cws-upload.sh
rm -f cws-upload.zip && cd cws-upload && zip -r ../cws-upload.zip . -x '*.DS_Store' && cd ..
```

Check that `manifest.json` is at the root of the ZIP (not inside a `cws-upload/` folder):

```bash
unzip -l cws-upload.zip
```

In the dashboard: **Items → New item → upload `cws-upload.zip`**.

---

## 3. Store listing tab

**Name** (comes from the manifest): `Follow Check for Instagram`

> Instagram's brand rules only allow "for Instagram" style names. Don't rename it to anything starting with "Instagram", or containing "Insta" or "Gram".

**Summary** (comes from the manifest, 125/132 chars):

```text
Unofficial tool to compare Instagram followers and following from your logged-in tab. No passwords. Not affiliated with Meta.
```

**Description** (paste as-is; it mentions "Instagram" 4 times on purpose, since repeating a keyword more than 5 times counts as keyword spam):

```text
Follow Check for Instagram compares your followers and following lists from the account you're already signed into, so you can see who doesn't follow you back.

This is an unofficial tool. It is not affiliated with, endorsed by, or sponsored by Instagram or Meta Platforms, Inc.

WHAT IT DOES
• See who doesn't follow you back, with a Remove button
• See who follows you that you don't follow, with a Follow back button
• See your mutual follows
• Filter any list by verified / not verified accounts
• Search by username or name
• Export the results as a CSV file

HOW IT WORKS
1. Open instagram.com and sign in as usual.
2. Click the Follow Check icon at the top right of the page (or the extension icon, then Open Follow Check).
3. Click Scan my lists.
4. Browse the results. Everything runs inside that browser tab.

PRIVACY
• No password is ever requested or collected.
• Nothing is sent to the developer or to any third-party server.
• Nothing is stored: results are discarded when you close or refresh the tab.
• Network requests go only to Instagram and its image servers, using your existing signed-in session, and only after you click Scan, Remove, or Follow back.

GOOD TO KNOW
• Follow and unfollow happen one account at a time, only when you click. There is no bulk or automatic unfollowing.
• Large accounts take longer to scan.
```

**Category:** Lifestyle → Social Networking
**Language:** English

**Graphic assets** (all in `store/graphics/`):

| Field | File | Size |
| --- | --- | --- |
| Store icon | `store-icon-128.png` | 128×128 |
| Screenshot 1 | `promo-1-overview.png` | 1280×800 |
| Screenshot 2 | `promo-2-lists.png` | 1280×800 |
| Screenshot 3 | `promo-3-actions.png` | 1280×800 |
| Screenshot 4 | `promo-4-live-scan.png` | 1280×800 |
| Screenshot 5 | `promo-5-privacy.png` | 1280×800 |
| Small promo tile | `promo-small-440x280.png` | 440×280 |
| Marquee promo tile (optional) | `promo-marquee-1400x560.png` | 1400×560 |

The store takes at most 5 screenshots. The plain UI screenshots (`screenshot-01-popup.png` to `screenshot-04-results.png`, 1280×800) are kept as alternates if you'd rather show the bare interface.

The screenshots and promo tiles are rendered from `store/_preview/*.html`. If the UI changes, update those files and run `sh store/render-graphics.sh` instead of editing the PNGs by hand.

The icon is built from `icons/icon-source.png`, edge to edge with rounded (transparent) corners. To change the corner radius or the artwork, replace the source and/or run `sh store/build-icons.sh 22` (radius as % of the icon size, default 22). This rebuilds every icon size and re-renders all the store images above.

Never use Instagram's camera logo (glyph) or wordmark in any of these images.

**Official URL:** leave blank.
**Homepage URL:** `https://github.com/JustPratiyush/Instagram_Followers_Check`
**Support URL:** `https://github.com/JustPratiyush/Instagram_Followers_Check/issues`
**Mature content:** No

---

## 4. Privacy tab

**Single purpose description:**

```text
Compare the signed-in user's Instagram followers and following lists, show who does and doesn't follow back, and let the user follow back or unfollow individual accounts from those lists.
```

**Permission justifications.** The manifest requests **only host permissions**; there are no API permissions to justify.

`https://www.instagram.com/*`

```text
Runs the in-page panel on instagram.com and sends the requests that load the user's own followers/following lists and profile totals, and single follow/unfollow actions when the user clicks them. Requests use the user's existing signed-in session in that tab. Nothing is sent anywhere else.
```

`https://*.cdninstagram.com/*`

```text
Profile photos in the results table are hosted on Instagram's image CDN. If a photo fails to load directly in the page, the background service worker fetches that one image so it can be displayed. The worker refuses any URL outside these CDN hosts.
```

`https://*.fbcdn.net/*`

```text
Some Instagram profile photos are served from Meta's fbcdn.net CDN. Used only for the same profile-photo fallback described above.
```

**Are you using remote code?** No, I am not using remote code.

(If asked to explain: all JavaScript is inside the package. `page-bridge.js` is a bundled file injected into the Instagram tab so its requests carry the user's session. It loads no external code.)

**Data usage.** Tick exactly these:

- [x] **Personally identifiable information**: usernames, display names and account IDs of the user and of the accounts in their lists
- [x] **Authentication information**: the extension reads Instagram's CSRF token cookie in the tab to authorise requests on the user's behalf. It never sees or stores passwords
- [x] **Website content**: follower/following lists, profile photos, and the user's own follower/following totals, loaded from instagram.com

Leave unticked: Health, Financial and payment, Personal communications, Location, Web history, User activity.

**Certifications.** Tick all three:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** the GitHub Pages URL from step 0.

---

## 5. Test instructions tab

Fill in the test account's username and password in the credential fields, and paste this into the additional instructions:

```text
This extension works only on https://www.instagram.com/ while signed in. It has no login of its own. Please use the test account provided (a dedicated test account, not a real person's).

1. Install the package, open https://www.instagram.com/ and sign in with the test account. Dismiss any "save login info" or notifications prompts.
2. Click the Follow Check icon at the top right of the page (or the extension's toolbar icon → "Open Follow Check").
3. Read the disclosure text and click "Scan my lists". Followers and following load within a few seconds.
4. Switch between "Don't follow you", "You don't follow", "Follow back", "Followers" and "Following". Try the Verified filter and the search box.
5. Optional: "Remove" unfollows that single account; "Follow back" follows that single account; "Export CSV" downloads the results.

No data is sent to any server other than Instagram, and nothing is stored after the tab is closed.
```

---

## 6. Distribution tab

- **Payments:** Free
- **Visibility:** Public (or Unlisted if you want a link-only soft launch first)
- **Regions:** All regions

---

## 7. Submit

Click **Submit for review**. If you want to choose the go-live moment yourself, untick "publish automatically after approval".

- Most reviews finish within a few days, but new developers and new items can take up to about 3 weeks. Contact support only after 3 weeks.
- A rejection email names the policy (for example "Purple Potassium" = excessive permissions, "Purple Nickel" = user-data disclosure). Fix the issue, bump the version in `manifest.json`, rebuild the ZIP and resubmit, or appeal from the dashboard.

### Every future update

1. Bump `"version"` in `manifest.json`.
2. If you add a permission or change what data is handled, update this file **and** `store/privacy-policy.html` (plus its effective date) in the same release.
3. Rebuild the ZIP (step 2), then use **Package → Upload new package** in the dashboard and submit.
