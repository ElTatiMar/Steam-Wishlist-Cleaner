# Steam Wishlist Cleaner

A fast and automated browser console script to iteratively clear all items from your Steam wishlist using the official **Steam Web API** (`IWishlistService/RemoveFromWishlist`).

---

## Features

- **Steam Web API Powered**: Uses Steam's modern service endpoint (`IWishlistService/RemoveFromWishlist/v1`) with authenticated Web API tokens.
- **Zero Dependencies**: Pure vanilla JavaScript designed to run directly in your browser's Developer Tools console.
- **Detailed Progress Logging**: Real-time `console.log()` updates showing item index, percentage completed, AppID, removal status, and a final summary.
- **Rate-Limit & Error Protection**: Includes customizable delay between requests (default `250ms`) and automatic retry backoff on HTTP 429 (Too Many Requests).

---

## How It Works

Modern Steam wishlist pages use server-side rendering (SSR) containing a `<script id="valve-ssr-data">` tag. This tag embeds:

1. `strWebAPIToken`: A signed Steam Web API JWT bearer token issued for store operations.
2. `renderContext.queryData`: Cached data containing the complete list of games on your wishlist with their `appid`.

The script extracts these credentials directly from the page DOM and sends iterative `POST` requests to:

```text
https://api.steampowered.com/IWishlistService/RemoveFromWishlist/v1/
```

---

## Usage

1. In your web browser, navigate to your Steam Wishlist:

   ```text
   https://store.steampowered.com/wishlist/
   ```

2. Ensure you are logged into your Steam account.
3. Open your browser's Developer Tools (`F12` or `Ctrl + Shift + I` / `Cmd + Option + I`).
4. Switch to the **Console** tab.
5. Copy the entire contents of [steam-wishlist-cleaner.js](steam-wishlist-cleaner.js), paste into the console, and press `Enter`.
6. Once finished, refresh the page (`F5`) to verify your wishlist is empty.

---

## Configuration

You can customize the settings at the top of [steam-wishlist-cleaner.js](steam-wishlist-cleaner.js):

| Option | Default | Description |
| --- | --- | --- |
| `delayMs` | `250` | Delay between consecutive removals in milliseconds to prevent rate limiting. |
| `maxRetries` | `3` | Maximum retry attempts per item if an error or HTTP 429 occurs. |
| `retryDelayMs` | `2500` | Base backoff delay (in milliseconds) before retrying a failed request. |

---

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).
