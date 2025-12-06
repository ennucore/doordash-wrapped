# DoorDash Wrapped Chrome Extension

A Chrome extension that generates your personalized "DoorDash Wrapped" - a fun summary of your DoorDash order history, similar to Spotify Wrapped.

## Features

- **Automatic Data Capture**: Intercepts DoorDash order history requests and stores data locally
- **Privacy First**: All data stays on your device, no external servers involved
- **Beautiful Stats**: View your total orders, spending, favorite restaurants, and more
- **Manifest V3**: Built with the latest Chrome extension standards

## Installation

1. **Load the Extension**:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in the top right)
   - Click "Load unpacked"
   - Select this directory (`/Users/lev/dev/doordash-wrapped`)

2. **Verify Installation**:
   - You should see "DoorDash Wrapped" appear in your extensions list
   - The extension icon should appear in your Chrome toolbar

## How to Use

1. **Capture Your Order Data**:
   - Visit [DoorDash Orders](https://www.doordash.com/orders/) while logged into your account
   - The extension will automatically capture your order history AND fetch all pages
   - When it detects the first page of orders, it will automatically request all remaining pages (with a 500ms delay between requests to be respectful to DoorDash's servers)
   - Watch the browser console for progress logs: `[DoorDash Wrapped] Fetching page at offset X...`
   - The process is automatic and will continue until all your order history is captured

2. **View Your Wrapped**:
   - Click the DoorDash Wrapped extension icon in your toolbar
   - Your stats will appear, including:
     - Total orders
     - Total amount spent
     - Average order value
     - Total items ordered
     - Your top 5 restaurants

## How It Works

The extension uses a multi-component architecture:

1. **Injected Script** (`injected.js`):
   - Runs in the page context and monkeypatches `fetch` and `XMLHttpRequest` to intercept DoorDash's GraphQL API calls
   - When it detects the first page of order results (offset=0 with 10 orders), it automatically fetches all remaining pages
   - Makes paginated requests with increasing offsets until all historical data is captured
   - Sends each batch of orders to the extension for storage

2. **Content Script** (`content.js`): Bridges messages between the page and the extension

3. **Background Worker** (`background.js`):
   - Stores and processes order data in `chrome.storage.local`
   - Normalizes the GraphQL response into a consistent format
   - Deduplicates orders by ID to handle overlapping page requests

4. **Popup UI** (`popup.html` + `popup.js`):
   - Displays your personalized stats
   - Shows collection status and last update time
   - Computes aggregate statistics from all captured orders

## Privacy & Security

- ✅ All data is stored locally in your browser
- ✅ No data is sent to external servers
- ✅ Only monitors DoorDash order history requests
- ✅ No passwords or credentials are accessed
- ✅ Open source - you can review all the code

## Debugging

If the extension isn't capturing data:

1. **Check Console Logs**:
   - Open DevTools on `doordash.com` (F12)
   - Look for messages starting with `[DoorDash Wrapped]`

2. **Check Background Worker**:
   - Go to `chrome://extensions/`
   - Find "DoorDash Wrapped" and click "service worker"
   - Check the console for any errors

3. **Verify Storage**:
   - In the background worker console, run:
     ```javascript
     chrome.storage.local.get(['dd_normalized_orders'], console.log)
     ```

## Technical Details

- **Manifest Version**: 3
- **Permissions**: `storage`
- **Host Permissions**: `https://www.doordash.com/*`
- **Target API**: DoorDash GraphQL `getConsumerOrdersWithDetails` endpoint

## Files

- `manifest.json` - Extension configuration
- `content.js` - Content script (bridge)
- `injected.js` - Page-context script (network hooks)
- `background.js` - Service worker (data storage)
- `popup.html` - Popup UI structure
- `popup.js` - Popup logic and stats computation
- `spec.md` - Original specification document

## Future Enhancements

Potential improvements:
- Year filtering (e.g., "2024 Wrapped")
- More detailed stats (order times, cuisines, etc.)
- Export data to JSON/CSV
- Charts and visualizations
- Sharing your wrapped on social media

## License

MIT License - Feel free to modify and distribute!
