# LevOJ One-Click Solution

> Built for NUIST students: open a LevOJ problem page and the extension grabs the
> statement, calls the AI, and hands back ready-to-submit C++ code.
> Chrome / Edge extension (Manifest V3) — no backend, install and go.

![version](https://img.shields.io/badge/version-1.3.1-4d6bfe)
![manifest](https://img.shields.io/badge/manifest-v3-4d6bfe)

<!-- Screenshots: uncomment once the image is in the repo -->
<!-- ![panel](docs/screenshot.png) -->

## Features

- **Automatic answers** — visiting `/problem/{id}` scrapes the problem and calls the AI with zero clicks.
- **Code only** — no filler; you get one complete, ready-to-submit C++ block with a copy button.
- **Two-stage scraping** — prefers the judge's `/v1/problem/{id}` API and falls back to DOM scraping (several selectors plus a generic heuristic) when the API is unavailable.
- **Leaves the host page alone** — all UI lives in a Shadow DOM, so its styles stay fully isolated from the judge site.
- **Your key never leaves the machine** — the API key is stored only in the extension's local storage, and requests are proxied through the background service worker.
- **Retries on 429** — honours `Retry-After` with backoff, and distinguishes rate limiting from exhausted quota in plain language.
- **Safety switch** — disabled automatically on `/exam`, `/contest` and `/compete` pages; the launcher turns orange.

## Installation

1. Open your browser and go to `chrome://extensions` (`edge://extensions` on Edge).
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left corner and select this project folder.
4. A blue whale icon appears in the toolbar — you're set.

## Configuration

Click the whale icon in the toolbar (or the ⚙ button in the floating panel on a problem page) and fill in any OpenAI-compatible endpoint:

| Field | Example |
| --- | --- |
| API Base URL | `https://api.deepseek.com/v1` |
| API Key | `sk-xxxxxxxx` |
| Model | `deepseek-chat` |

Hit **Test connection**, then **Save**. You may also tick **Answer automatically on problem pages** (on by default).

> OpenAI, Qwen (DashScope), a self-hosted gateway — anything OpenAI-compatible works. A missing `/v1` suffix is added automatically.

## Usage

1. Open a problem page — the URL must contain `/problem/<number>`.
2. A floating panel appears in the bottom-right and starts working; wait a few seconds.
3. Click **Copy** at the top-right of the code block, then paste it into the submit box.

If the panel covers the statement, drag it by the title bar; use `—` to collapse it into the ball, and click the ball to bring it back.

## Adapting to another judge

This project targets LevOJ (intranet `172.16.37.108`) out of the box. To move it elsewhere, change two things:

- `manifest.json` → `content_scripts[0].matches` and `host_permissions` to your own domain;
- `content.js` → the endpoint in `fetchProblemViaAPI()` (`/v1/problem/{id}`) and the `RESTRICTED_RE` blocklist.

Problem-ID parsing lives in `parseProblemId()` and matches `/problem/(\d+)` by default.

## Project layout

```
levoj-ai-helper-extension/
├── manifest.json      # MV3 manifest: permissions, content-script matching, entry point
├── background.js      # service worker: proxies AI requests (bypasses page CORS)
├── content.js         # injected into the judge page: scraping, floating panel, auto-answer
├── popup.html/js      # toolbar settings popup
└── preview.html       # static UI preview page (not part of the extension)
```

**Request flow**: content script scrapes the problem → `chrome.runtime.sendMessage` → background `fetch`es the AI endpoint → text comes back → content script renders the Markdown.

## Troubleshooting

The extension reports errors in Chinese; the left column below quotes them verbatim.

| Symptom | Fix |
| --- | --- |
| `未配置 API Key` — no API key set | Fill it in once via **Configuration** above |
| `AI 接口错误 429` — HTTP 429 | Rate-limited or out of quota; turn off auto-answer, retry later, or switch keys |
| `后台无响应` — no response from background | The extension was just reloaded — press `Ctrl+Shift+R` on the page |
| No ball in the corner | Make sure you're on a problem page; press `Ctrl+Shift+R`; check the extension isn't disabled |
| `未抓取到题目` — could not scrape the problem | Not a problem-detail page, or the page hasn't finished loading; open the problem from the list |

## Notes

- **Disabled on exam / contest pages.** The assistant stays inactive on `/exam`, `/contest` and `/compete`. This is deliberate and should not be removed.
- **Generated code is a reference only.** Read it and understand the approach before submitting anything.
- **Logo.** The whale mark is a hand-drawn approximation and **not official DeepSeek artwork**; the trademark belongs to its owner. To use the official logo, replace `LOGO_SVG` in `content.js` — the swap is documented in the comment directly above it.
- Never commit or share your API key.

## Development

No build step and no dependencies. Edit the source and hit the reload button for the extension on `chrome://extensions`. After changing `content.js`, hard-refresh any open judge page. For UI work, preview the styles offline in `preview.html` — it shares the same CSS as the extension, with `:host` swapped for `:root`.

## License

MIT — see [LICENSE](LICENSE).
