// Injected script - runs in page context to intercept network requests
(function() {
  console.log('[DoorDash Wrapped] Injected script running in page context');

  const ORDERS_SUBSTRING = 'getConsumerOrdersWithDetails';
  const ADDRESSES_SUBSTRING = 'getAvailableAddresses';
  let isAutoFetching = false;
  let capturedRequestDetails = null;
  let lastFetchDate = localStorage.getItem('dd_wrapped_last_fetch_date');

  // Helper to check if a URL matches our target
  function isOrdersRequest(url) {
    return typeof url === 'string' && url.includes(ORDERS_SUBSTRING);
  }

  function isAddressesRequest(url) {
    return typeof url === 'string' && url.includes(ADDRESSES_SUBSTRING);
  }

  function getTodayString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function shouldSkipAutoFetch() {
    const today = getTodayString();
    if (lastFetchDate === today) {
      console.log('[DoorDash Wrapped] Orders already fetched today, skipping auto-fetch');
      return true;
    }
    return false;
  }

  // Helper to extract URL from fetch arguments
  function getUrlFromFetchArgs(args) {
    if (!args || args.length === 0) return null;

    const input = args[0];
    if (typeof input === 'string') {
      return input;
    } else if (input instanceof Request) {
      return input.url;
    }
    return null;
  }

  // Helper to get request body from fetch arguments
  function getRequestBody(args) {
    if (!args || args.length < 2) return null;

    const options = args[1];
    if (options && options.body) {
      try {
        return typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  // Helper to get headers from fetch arguments
  function getRequestHeaders(args) {
    if (!args || args.length < 2) return {};

    const options = args[1];
    if (options && options.headers) {
      return options.headers;
    }
    return {};
  }

  // Function to fetch all pages of orders
  async function fetchAllOrders(initialUrl, initialHeaders, initialBody) {
    if (isAutoFetching) return;

    isAutoFetching = true;
    console.log('[DoorDash Wrapped] Starting auto-fetch of all order pages...');

    try {
      const limit = initialBody?.variables?.limit || 10;
      let offset = limit; // Start from next page
      let hasMore = true;

      while (hasMore) {
        // Wait a bit between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

        const body = {
          ...initialBody,
          variables: {
            ...initialBody.variables,
            offset: offset
          }
        };

        console.log(`[DoorDash Wrapped] Fetching page at offset ${offset}...`);

        try {
          const response = await originalFetch(initialUrl, {
            method: 'POST',
            headers: initialHeaders,
            body: JSON.stringify(body),
            credentials: 'include'
          });

          const data = await response.json();
          const orders = data?.data?.getConsumerOrdersWithDetails || [];

          console.log(`[DoorDash Wrapped] Fetched ${orders.length} orders at offset ${offset}`);

          if (orders.length > 0) {
            // Send this batch to the extension
            window.postMessage({
              source: 'DD_WRAPPED_PAGE',
              payload: {
                type: 'fetch',
                url: initialUrl,
                data: data,
                isAutoPaginated: true,
                offset: offset
              }
            }, '*');

            offset += limit;
            hasMore = orders.length === limit;
          } else {
            hasMore = false;
          }
        } catch (err) {
          console.error('[DoorDash Wrapped] Error fetching page:', err);
          hasMore = false;
        }
      }

      console.log('[DoorDash Wrapped] Finished auto-fetching all orders');
    } finally {
      isAutoFetching = false;
    }
  }

  // Hook fetch
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const url = getUrlFromFetchArgs(args);

    // Call original fetch
    const fetchPromise = originalFetch.apply(this, args);

    // If this is an addresses request, capture it
    if (url && isAddressesRequest(url)) {
      console.log('[DoorDash Wrapped] Intercepted getAvailableAddresses request:', url);

      fetchPromise.then(response => {
        const clone = response.clone();
        clone.json()
          .then(data => {
            console.log('[DoorDash Wrapped] Captured address data:', data);

            // Post message to content script
            window.postMessage({
              source: 'DD_WRAPPED_PAGE',
              payload: {
                type: 'addresses',
                url: url,
                data: data
              }
            }, '*');
          })
          .catch(err => {
            console.error('[DoorDash Wrapped] Error parsing addresses response:', err);
          });
      }).catch(err => {
        console.error('[DoorDash Wrapped] Addresses fetch error:', err);
      });
    }

    // If this is an orders request, clone and extract the response
    if (url && isOrdersRequest(url)) {
      console.log('[DoorDash Wrapped] Intercepted fetch request:', url);

      fetchPromise.then(response => {
        // Clone the response so we don't interfere with the original
        const clone = response.clone();

        clone.json()
          .then(data => {
            console.log('[DoorDash Wrapped] Captured order data from fetch:', data);

            // Post message to content script
            window.postMessage({
              source: 'DD_WRAPPED_PAGE',
              payload: {
                type: 'fetch',
                url: url,
                data: data
              }
            }, '*');

            // Check if we should auto-fetch more pages
            const orders = data?.data?.getConsumerOrdersWithDetails || [];
            const requestBody = getRequestBody(args);
            const requestHeaders = getRequestHeaders(args);
            const offset = requestBody?.variables?.offset || 0;
            const limit = requestBody?.variables?.limit || 10;

            // Only trigger auto-fetch on the first page (offset 0) and if we got a full page
            if (offset === 0 && orders.length === limit && !isAutoFetching && !shouldSkipAutoFetch()) {
              console.log('[DoorDash Wrapped] First page has full results, fetching remaining pages...');
              // Update the last fetch date
              const today = getTodayString();
              localStorage.setItem('dd_wrapped_last_fetch_date', today);
              lastFetchDate = today;

              fetchAllOrders(url, requestHeaders, requestBody).catch(err => {
                console.error('[DoorDash Wrapped] Error in auto-fetch:', err);
              });
            }
          })
          .catch(err => {
            console.error('[DoorDash Wrapped] Error parsing fetch response:', err);
          });
      }).catch(err => {
        console.error('[DoorDash Wrapped] Fetch error:', err);
      });
    }

    return fetchPromise;
  };

  // Hook XMLHttpRequest
  const OriginalXHR = window.XMLHttpRequest;

  window.XMLHttpRequest = function() {
    const xhr = new OriginalXHR();

    // Store the original open and send methods
    const originalOpen = xhr.open;
    const originalSend = xhr.send;

    // Override open to capture the URL
    xhr.open = function(method, url, ...rest) {
      this.__dd_url = url;
      this.__dd_method = method;
      return originalOpen.apply(this, [method, url, ...rest]);
    };

    // Override send to capture the response
    xhr.send = function(...args) {
      // Add load event listener
      this.addEventListener('load', function() {
        const url = this.__dd_url;

        if (url && isOrdersRequest(url)) {
          console.log('[DoorDash Wrapped] Intercepted XHR request:', url);

          try {
            const data = JSON.parse(this.responseText);
            console.log('[DoorDash Wrapped] Captured order data from XHR:', data);

            // Post message to content script
            window.postMessage({
              source: 'DD_WRAPPED_PAGE',
              payload: {
                type: 'xhr',
                url: url,
                data: data
              }
            }, '*');
          } catch (err) {
            console.error('[DoorDash Wrapped] Error parsing XHR response:', err);
          }
        }
      });

      return originalSend.apply(this, args);
    };

    return xhr;
  };

  // Copy over static properties
  for (const prop in OriginalXHR) {
    if (OriginalXHR.hasOwnProperty(prop)) {
      window.XMLHttpRequest[prop] = OriginalXHR[prop];
    }
  }
  window.XMLHttpRequest.prototype = OriginalXHR.prototype;

  console.log('[DoorDash Wrapped] Network hooks installed successfully');
})();
