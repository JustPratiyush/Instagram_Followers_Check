# Follow Check for Instagram

![Follow Check for Instagram — see who doesn’t follow you back](store/graphics/promo-marquee-1400x560.png)

A Chrome extension that compares your Instagram **followers** and **following** from your already logged-in browser session.

No passwords. No Instagram login form. It only works when you’re signed in on [instagram.com](https://www.instagram.com/).

---

## Features

- See who **follows you back**
- See who you follow that **doesn’t follow back** — with **Remove**
- See who follows you that **you don’t follow** — with **Follow back**
- Filter any list by **Verified** / **Not verified**
- Export results as **CSV**

---

## Highlights

![Overview — see who doesn’t follow you back, with no passwords and nothing stored](store/graphics/promo-1-overview.png)

![Five lists — Don’t follow you, You don’t follow, Follow back, Followers and Following, with verified filter and search](store/graphics/promo-2-lists.png)

![Take action — remove or follow back one account at a time, confirmed by Instagram](store/graphics/promo-3-actions.png)

![Live progress — followers and following load side by side with a real percentage](store/graphics/promo-4-live-scan.png)

![Private by design — no passwords, no servers, nothing stored, CSV export only when you ask](store/graphics/promo-5-privacy.png)

These images are rendered from `store/_preview/promo-*.html` with sample data; run `sh store/render-graphics.sh` to rebuild them.

---

## How it looks

### 1. Scanning

Followers and following load in parallel, with live progress.

![Scanning followers and following](docs/02-scanning.png)

### 2. Results

Browse categories, filter verified accounts, and take action. Usernames, names and photos are blurred here for privacy.

![Results dashboard with lists and actions](docs/03-results.png)

---

## Install

1. Clone this repo (or download the ZIP and unzip it)
2. Open Chrome → `chrome://extensions`
3. Turn on **Developer mode**
4. Click **Load unpacked**
5. Select this project folder
6. Open [instagram.com](https://www.instagram.com/) and log in
7. Click the **Follow Check** icon (top right of the page), or the extension’s toolbar icon → **Open Follow Check**, then **Scan my lists**

---

## Usage

| Column | Meaning |
| --- | --- |
| Don’t follow you | You follow them; they don’t follow you |
| You don’t follow | They follow you; you don’t follow them |
| Follow back | Mutual follows |
| Followers / Following | Full lists |

On each row you can:

- **Remove** — unfollow someone you currently follow
- **Follow back** — follow someone who already follows you

Use the **All / Verified / Not verified** filters on any column.

---

## Notes

- Requires an active Instagram web session in the same tab
- After updating the extension, click **Reload** on `chrome://extensions`, then refresh Instagram
- Large accounts take longer; followers and following load in parallel
- Use responsibly — this uses Instagram’s logged-in web APIs

---

## Privacy

- No passwords are collected
- No data is sent to a third-party server by this extension
- Comparison runs locally in your browser using your Instagram session
- Nothing is stored — results are discarded when you close or refresh the tab
- Full policy: [store/privacy-policy.html](store/privacy-policy.html)

This extension is unofficial and is not affiliated with Instagram or Meta.
