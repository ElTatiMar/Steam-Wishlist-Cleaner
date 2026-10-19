/**
 * Steam Wishlist Cleaner
 *
 * Iteratively removes all games from your Steam wishlist using the official
 * Steam Web API (IWishlistService/RemoveFromWishlist).
 *
 * Works in:
 * 1. Node.js: Reads "wishlist.html" saved in the same directory.
 * 2. Browser Console: Run directly on https://store.steampowered.com/wishlist/
 */

(function () {
  'use strict';

  // Configuration settings
  const CONFIG = {
    // Delay between each removal in milliseconds (helps avoid HTTP 429 rate-limiting)
    delayMs: 250,
    // Maximum retry attempts if a request fails or is rate-limited
    maxRetries: 3,
    // Delay before retrying after an error or rate-limit
    retryDelayMs: 2500,
    // Steam Web API endpoint for wishlist removal
    apiUrl: 'https://api.steampowered.com/IWishlistService/RemoveFromWishlist/v1/'
  };

  /**
   * Pause execution for a given number of milliseconds
   */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Format milliseconds into human-readable duration (e.g. "1m 24s")
   */
  function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }

  /**
   * Universal HTTP POST helper supporting both browser fetch and Node.js
   */
  async function httpPost(urlStr, formBody) {
    if (typeof fetch !== 'undefined') {
      return fetch(urlStr, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body: formBody
      });
    }

    // Node.js fallback using built-in https module
    const https = require('https');
    const { URL } = require('url');
    const url = new URL(urlStr);

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Content-Length': Buffer.byteLength(formBody)
          }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              statusText: res.statusMessage,
              json: async () => JSON.parse(data || '{}'),
              text: async () => data
            });
          });
        }
      );

      req.on('error', reject);
      req.write(formBody);
      req.end();
    });
  }

  /**
   * Extract Web API token, steamid, and wishlist AppIDs from wishlist.html or browser DOM
   */
  function extractWishlistData() {
    let rawJson = null;
    let sourceDescription = '';

    // 1. In Browser: inspect document for #valve-ssr-data
    if (typeof document !== 'undefined') {
      const ssrElement = document.getElementById('valve-ssr-data');
      if (ssrElement && ssrElement.textContent) {
        rawJson = ssrElement.textContent.trim();
        sourceDescription = 'DOM element (#valve-ssr-data)';
      }
    }

    // 2. In Node.js: read from local wishlist.html
    if (!rawJson && typeof process !== 'undefined' && process.versions?.node) {
      try {
        const fs = require('fs');
        const path = require('path');
        const filePath = path.resolve(__dirname || '.', 'wishlist.html');

        if (fs.existsSync(filePath)) {
          const htmlContent = fs.readFileSync(filePath, 'utf8');
          const scriptMatch = htmlContent.match(
            /<script[^>]*id=["']valve-ssr-data["'][^>]*>([\s\S]*?)<\/script>/i
          );
          if (scriptMatch) {
            rawJson = scriptMatch[1].trim();
            sourceDescription = `File (${filePath})`;
          } else {
            console.warn('[!] Found wishlist.html, but <script id="valve-ssr-data"> tag was not found.');
          }
        } else {
          console.warn(`[!] wishlist.html not found at: ${filePath}`);
        }
      } catch (err) {
        console.error('[!] Failed to read local wishlist.html file:', err.message);
      }
    }

    if (!rawJson) {
      throw new Error(
        'Wishlist data could not be located. Please make sure wishlist.html is present in the workspace, or run this script in the browser console on https://store.steampowered.com/wishlist/'
      );
    }

    let parsedSsr;
    try {
      parsedSsr = JSON.parse(rawJson);
    } catch (err) {
      throw new Error(`Failed to parse SSR JSON data: ${err.message}`);
    }

    let webApiToken = null;
    let steamId = null;

    // Extract strWebAPIToken and steamid from loaderData
    if (Array.isArray(parsedSsr.loaderData)) {
      for (const entry of parsedSsr.loaderData) {
        try {
          const obj = typeof entry === 'string' ? JSON.parse(entry) : entry;
          if (obj?.strWebAPIToken) {
            webApiToken = obj.strWebAPIToken;
          }
          if (obj?.steamid) {
            steamId = obj.steamid;
          }
        } catch (_) {}
      }
    }

    // Extract items from renderContext.queryData
    const appIds = [];
    if (parsedSsr.renderContext?.queryData) {
      try {
        const queryData =
          typeof parsedSsr.renderContext.queryData === 'string'
            ? JSON.parse(parsedSsr.renderContext.queryData)
            : parsedSsr.renderContext.queryData;

        if (Array.isArray(queryData?.queries)) {
          for (const query of queryData.queries) {
            const items = query?.state?.data?.items;
            if (Array.isArray(items)) {
              for (const item of items) {
                if (item?.appid && !appIds.includes(item.appid)) {
                  appIds.push(item.appid);
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('[!] Error parsing queryData for items:', err.message);
      }
    }

    // Fallback: search raw JSON for AppID entries if queryData didn't yield items
    if (appIds.length === 0) {
      const appidRegex = /"appid"\s*:\s*(\d+)/g;
      let match;
      while ((match = appidRegex.exec(rawJson)) !== null) {
        const id = parseInt(match[1], 10);
        if (!appIds.includes(id)) {
          appIds.push(id);
        }
      }
    }

    return {
      source: sourceDescription,
      webApiToken,
      steamId,
      appIds
    };
  }

  /**
   * Remove a single game from Steam wishlist using Steam Web API
   */
  async function removeWishlistItem(appId, token, options = {}) {
    const maxRetries = options.maxRetries || CONFIG.maxRetries;
    const retryDelayMs = options.retryDelayMs || CONFIG.retryDelayMs;

    const bodyParams = new URLSearchParams();
    bodyParams.append('access_token', token);
    bodyParams.append('input_json', JSON.stringify({ appid: appId }));
    bodyParams.append('appid', String(appId));

    const postBody = bodyParams.toString();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await httpPost(CONFIG.apiUrl, postBody);

        // Rate limit detected
        if (response.status === 429) {
          if (attempt < maxRetries) {
            const backoff = retryDelayMs * attempt;
            console.warn(
              `    [!] Rate limited (HTTP 429) for AppID ${appId}. Backing off for ${(backoff / 1000).toFixed(1)}s before retry ${attempt + 1}/${maxRetries}...`
            );
            await sleep(backoff);
            continue;
          }
          return { success: false, error: 'HTTP 429: Too Many Requests (Rate limit reached)' };
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          return {
            success: false,
            error: `HTTP ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
          };
        }

        return { success: true };
      } catch (err) {
        if (attempt < maxRetries) {
          console.warn(`    [!] Network error on attempt ${attempt}/${maxRetries}: ${err.message}. Retrying...`);
          await sleep(retryDelayMs);
        } else {
          return { success: false, error: err.message };
        }
      }
    }

    return { success: false, error: 'Exceeded maximum retry attempts' };
  }

  /**
   * Main cleanup runner: Iterates through all extracted items and removes them
   */
  async function cleanWishlist(customConfig = {}) {
    const config = { ...CONFIG, ...customConfig };
    const startTime = Date.now();

    console.log('==================================================');
    console.log('           STEAM WISHLIST CLEANER                 ');
    console.log('==================================================');

    // 1. Extract data
    let data;
    try {
      data = extractWishlistData();
    } catch (err) {
      console.error(`[✗] Initialization Error: ${err.message}`);
      return;
    }

    const { source, webApiToken, steamId, appIds } = data;
    const total = appIds.length;

    console.log(`[ℹ] Source:       ${source}`);
    console.log(`[ℹ] Steam ID:     ${steamId || 'Unknown'}`);
    console.log(`[ℹ] Web API Token: ${webApiToken ? `${webApiToken.substring(0, 16)}... (valid)` : 'MISSING'}`);
    console.log(`[ℹ] Total Games:  ${total}`);
    console.log(`[ℹ] Delay:        ${config.delayMs}ms between requests`);
    console.log('--------------------------------------------------');

    if (!webApiToken) {
      console.error(
        '[✗] Error: strWebAPIToken not found. If wishlist.html is stale or logged out, please re-save the page while logged into Steam.'
      );
      return;
    }

    if (total === 0) {
      console.log('[✓] Wishlist is already empty! No items to remove.');
      return;
    }

    console.log(`[▶] Starting removal of ${total} games via Steam Web API...\n`);

    let successCount = 0;
    let failCount = 0;
    const failedAppIds = [];

    // 2. Iterate and remove each item
    for (let i = 0; i < total; i++) {
      const appId = appIds[i];
      const progressPercent = (((i + 1) / total) * 100).toFixed(1);
      const prefix = `[${i + 1}/${total}] (${progressPercent}%)`;

      const result = await removeWishlistItem(appId, webApiToken, config);

      if (result.success) {
        successCount++;
        console.log(`${prefix} AppID ${appId} -> [REMOVED]`);
      } else {
        failCount++;
        failedAppIds.push({ appId, error: result.error });
        console.error(`${prefix} AppID ${appId} -> [FAILED] (${result.error})`);
      }

      // Delay between requests
      if (i < total - 1 && config.delayMs > 0) {
        await sleep(config.delayMs);
      }
    }

    const elapsed = formatDuration(Date.now() - startTime);

    // 3. Final summary
    console.log('\n==================================================');
    console.log('                CLEANUP SUMMARY                   ');
    console.log('==================================================');
    console.log(`[✓] Completed in:        ${elapsed}`);
    console.log(`[✓] Total Processed:     ${total}`);
    console.log(`[✓] Successfully Removed:${successCount}`);
    console.log(`[${failCount > 0 ? '✗' : '✓'}] Failed:               ${failCount}`);

    if (failCount > 0) {
      console.log('\n[!] Failed AppIDs:');
      failedAppIds.forEach((f) => console.log(`    - AppID ${f.appId}: ${f.error}`));
    } else {
      console.log('\n🎉 Your Steam wishlist is now completely clean!');
    }

    if (typeof window !== 'undefined') {
      console.log('\n[ℹ] Refresh your browser tab (F5) to see the empty wishlist.');
    }
    console.log('==================================================');
  }

  // Export functions or auto-run
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { cleanWishlist, extractWishlistData, removeWishlistItem };
  }

  // Automatically execute if running directly in Node.js or in browser console
  const isNode = typeof process !== 'undefined' && process.versions?.node;
  const isBrowser = typeof window !== 'undefined';

  if (isNode) {
    // If run via `node steam-wishlist-cleaner.js`
    cleanWishlist();
  } else if (isBrowser) {
    // Auto-run in browser console
    cleanWishlist();
  }
})();
