# DoorDash Wrapped – Chrome Extension Spec

This document describes the idea, data flow, and implementation plan for a Chrome extension that generates a “DoorDash Wrapped” from a user’s DoorDash account, similar to Spotify Wrapped.

The goal is to give an AI enough structure to generate all needed code files.

---

## 1. High-level idea

**Problem:** DoorDash does not provide an easy, fun summary of your yearly usage (total orders, money spent, favorite restaurants, etc.).

**Goal:** Build a Chrome extension that, when the user visits `doordash.com` while logged in, automatically:

1. **Intercepts DoorDash’s network calls** that fetch the user’s order history.
2. **Extracts the JSON response** from those calls.
3. **Stores the data** in `chrome.storage.local`.
4. **Processes it into stats** (e.g. top restaurants, total spend, most common cuisine).
5. **Displays a Wrapped-style UI** in the extension popup (or a dedicated page).

Constraints and philosophy:

- **No backend** required; everything runs locally in the browser.
- **No passwords or cookies touched directly** by the extension.
- Work with **Manifest V3**.
- Leverage **content scripts + injected script** to read network responses (since MV3 APIs can’t access response bodies directly).

---

## 2. How data is captured

### Key DoorDash call

DoorDash uses a GraphQL endpoint similar to:

```text
https://www.doordash.com/graphql/getConsumerOrdersWithDetails

This request returns detailed order history. The extension:
	•	watches for this URL (or a substring like getConsumerOrdersWithDetails)
	•	clones the response
	•	parses the JSON
	•	posts it out to the extension

Why we can’t just use webRequest
	•	In Manifest V3, the recommended network API (declarativeNetRequest) can’t read response bodies.
	•	webRequest is limited and cannot give you response bodies either.
	•	Therefore we use JavaScript monkeypatching in the page context:
	•	override window.fetch
	•	optionally override XMLHttpRequest

This lets us see arguments and responses before DoorDash’s code consumes them.

⸻

3. Architecture overview

Components:
	1.	manifest.json
	•	Declares MV3 extension, host permissions, background service worker, content script, and popup.
	2.	content.js (content script)
	•	Injects injected.js into the page.
	•	Bridges window.postMessage messages from the page to the extension via chrome.runtime.sendMessage.
	3.	injected.js (page-context script)
	•	Runs in the same JS world as DoorDash.
	•	Monkeypatches window.fetch (and optionally XMLHttpRequest).
	•	When it sees a URL containing getConsumerOrdersWithDetails, it:
	•	clones the response
	•	calls clone.json()
	•	window.postMessage(...) the parsed data back to the page, tagged with a custom source field.
	4.	background.js (service worker)
	•	Listens for messages from content.js.
	•	Stores snapshots of order data in chrome.storage.local.
	•	Optionally performs pre-processing (dedupe orders, normalize schema).
	5.	Popup UI (popup.html + popup.js)
	•	Reads processed data from chrome.storage.local.
	•	Computes stats: total orders, total spend, favorite restaurant, etc.
	•	Renders visual summary (charts, lists, “#1 restaurant”, etc.).

⸻

4. Folder structure

The extension folder should look like:

doordash-wrapped-extension/
  manifest.json
  background.js
  content.js
  injected.js
  popup.html
  popup.js
  (optional) assets/...


⸻

5. Manifest details (manifest.json)

Requirements:
	•	Manifest version: 3
	•	Permissions: at minimum storage
	•	Host permissions: https://www.doordash.com/*
	•	Background: service worker (module or classic)
	•	Content script: run on DoorDash, document_start so hooks are installed early
	•	Action: popup

Behavior (in words):
	•	Declare a content script content.js for URLs matching DoorDash.
	•	Register background.js as the service worker.
	•	Add a browser action pointing to popup.html.

⸻

6. Content script responsibilities (content.js)

Main tasks:
	1.	Inject injected.js into the page context
	•	Create a <script> tag.
	•	Set src to chrome.runtime.getURL("injected.js").
	•	Append it to document.documentElement or document.head.
	•	Remove the script tag after it loads.
	2.	Bridge messages to the background
	•	Listen to window.addEventListener("message", ...).
	•	Only accept messages with a specific source (e.g. "DD_WRAPPED_PAGE") to avoid noise.
	•	When such a message is received, call chrome.runtime.sendMessage with { type: "DD_ORDERS", payload: ... }.

No business logic or data processing should live here; it’s just a bridge.

⸻

7. Injected script responsibilities (injected.js)

Runs in page context.

7.1 Identify target requests
	•	Define a helper like:

const TARGET_SUBSTRING = "getConsumerOrdersWithDetails";
function isOrdersRequest(url) {
  return typeof url === "string" && url.includes(TARGET_SUBSTRING);
}



7.2 Hook fetch
	•	Save original: const originalFetch = window.fetch;
	•	Replace with wrapper:
	•	Call original fetch: const res = await originalFetch.apply(this, args);
	•	Inspect args[0] to figure out the URL (string or Request object).
	•	If isOrdersRequest(url):
	•	const clone = res.clone();
	•	clone.json().then(data => window.postMessage({ source: "DD_WRAPPED_PAGE", payload: { type: "fetch", url, data } }, "*"));
	•	Return original res so the site still works.

7.3 Optional: hook XHR
	•	Override XMLHttpRequest.prototype.open to capture URL into this.__dd_url.
	•	Override XMLHttpRequest.prototype.send to listen for load and:
	•	Check isOrdersRequest(this.__dd_url).
	•	Parse this.responseText as JSON when possible.
	•	window.postMessage the data in the same shape as for fetch.

7.4 Message schema from page to extension

You can standardize on:

{
  source: "DD_WRAPPED_PAGE",
  payload: {
    type: "fetch" | "xhr",
    url: "<string>",
    data: <raw JSON from DoorDash GraphQL>
  }
}


⸻

8. Background service worker (background.js)

Responsibilities:
	1.	Listening for order payloads
	•	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => { ... })
	•	When message.type === "DD_ORDERS", read message.payload.
	2.	Storing data
	•	Use chrome.storage.local.get(["dd_orders_history"], ...).
	•	Maintain an array of snapshots, each like:

{
  ts: <timestamp>,
  sourceType: "fetch" | "xhr",
  url: "<string>",
  raw: <raw GraphQL response>
}


	•	Append new snapshot, write back to chrome.storage.local.

	3.	Processing data (optionally here or in popup)
You can either:
	•	Keep raw data only, and have the popup compute everything on the fly, or
	•	Preprocess into a normalized order schema here.
Potential normalized shape:

type WrappedOrder = {
  id: string;
  restaurantName: string;
  createdAt: string; // ISO date
  totalPrice: number; // in cents
  currency: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number; // in cents
  }>;
};

Then save both raw snapshots and an array of WrappedOrder objects.

⸻

9. Popup UI (popup.html + popup.js)

9.1 Data retrieval
	•	In popup.js, on load:
	•	Call chrome.storage.local.get(["dd_orders_history"], callback).
	•	Combine/normalize the data.
	•	Compute high-level stats.

9.2 Stats to compute

Some ideas:
	•	Total orders.
	•	Total money spent.
	•	Favorite restaurant (most orders or highest spend).
	•	Average order value.
	•	Most ordered dishes / cuisines.
	•	First and last order dates (timeline).

This can be done with straightforward JavaScript reductions over the orders dataset.

9.3 Rendering

Initial version can be simple HTML:
	•	<h1>DoorDash Wrapped</h1>
	•	<p>Total orders: X</p>
	•	<p>Total spend: $Y</p>
	•	<ul> of top restaurants etc.

Later, another AI can add:
	•	CSS styling.
	•	Canvas / SVG charts.
	•	Animations.

⸻

10. Privacy / security considerations
	•	The extension only runs on https://www.doordash.com/*.
	•	It only inspects requests containing getConsumerOrdersWithDetails (or similar).
	•	All captured data stays in chrome.storage.local on the user’s machine.
	•	No external network calls should be made by the extension unless explicitly added (for example, to sync to user’s own backend).

Make sure the AI does not:
	•	Ship user data to remote servers by default.
	•	Request unnecessary permissions.

⸻

11. Implementation checklist for the AI

When you hand this to an AI, ask it to:
	1.	Generate all extension files:
	•	manifest.json (MV3, as described).
	•	content.js (handles injection + message bridge).
	•	injected.js (fetch/XHR hooks + postMessage with payload).
	•	background.js (message listener, storage, basic normalization function).
	•	popup.html + popup.js (read data, compute stats, render simple UI).
	2.	Make sure:
	•	manifest_version: 3.
	•	Uses chrome.storage.local, not Sync for big data.
	•	Uses chrome.runtime.sendMessage/onMessage.
	•	Has "host_permissions": ["https://www.doordash.com/*"].
	3.	Optionally:
	•	Add TypeScript typings (if desired).
	•	Add simple error handling/logging.
	•	Provide instructions for testing via chrome://extensions → “Load unpacked”.

⸻

12. How to test (summary)
	1.	Load the extension via Load unpacked.
	2.	Log into DoorDash and open doordash.com.
	3.	Navigate to your order history (or any page that triggers the GraphQL orders call).
	4.	Open the extension popup to see if stats appear.
	5.	If nothing shows up, inspect:
	•	Background service worker console for logs.
	•	Content script console for any injection/permission errors.


