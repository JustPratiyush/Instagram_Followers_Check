# Follow Check for Instagram

A Chrome extension that compares your Instagram **followers** and **following** from your already logged-in browser session.

No passwords. No Instagram login form. It only works when you’re signed in on [instagram.com](https://www.instagram.com/).

---

## Features

- See who **follows you back**
- See who you follow that **doesn’t follow back** — with **Remove**
- See who follows you that **you don’t follow** — with **Follow back**
- Filter any list by **Verified** / **Not verified**
- View each account’s **followers** and **following** counts
- Export results as **CSV**

---

## How it looks

### 1. Start

Open the panel and scan your lists from the logged-in session.

![Start screen — Scan my lists](docs/01-start.png)

### 2. Scanning

Followers and following load in parallel, with live progress.

![Scanning followers and following](docs/02-scanning.png)

### 3. Results

Browse categories, filter verified accounts, inspect counts, and take action.

![Results dashboard with lists and actions](docs/03-results.png)

---

## Install

1. Clone this repo (or download the ZIP and unzip it)
2. Open Chrome → `chrome://extensions`
3. Turn on **Developer mode**
4. Click **Load unpacked**
5. Select this project folder
6. Open [instagram.com](https://www.instagram.com/) and log in
7. Click **Follow Check** (top right) → **Scan my lists**

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

Use the **All / Verified / Not verified** filters on any column. Profile counts load in the background (progress shows under search).

---

## Notes

- Requires an active Instagram web session in the same tab
- After updating the extension, click **Reload** on `chrome://extensions`, then refresh Instagram
- Large accounts take longer; counts are fetched with parallel workers
- Use responsibly — this uses Instagram’s logged-in web APIs

---

## Privacy

- No passwords are collected
- No data is sent to a third-party server by this extension
- Comparison runs locally in your browser using your Instagram session
- Nothing is stored — results are discarded when you close or refresh the tab
- Full policy: [store/privacy-policy.html](store/privacy-policy.html)

This extension is unofficial and is not affiliated with Instagram or Meta.
