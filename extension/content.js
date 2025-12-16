// Content script - bridges messages between the page and the extension
(function() {
  console.log('[DoorDash Wrapped] Content script loaded');

  // Inject the page-context script
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = function() {
    console.log('[DoorDash Wrapped] Injected script loaded');
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);

  // Listen for messages from the injected script
  window.addEventListener('message', function(event) {
    // Only accept messages from the same window
    if (event.source !== window) {
      return;
    }

    // Only accept messages with our specific source identifier
    if (event.data && event.data.source === 'DD_WRAPPED_PAGE') {
      const payload = event.data.payload;

      // Determine message type based on payload
      let messageType = 'DD_ORDERS';
      if (payload.type === 'addresses') {
        messageType = 'DD_ADDRESSES';
        console.log('[DoorDash Wrapped] Received address data from page:', event.data);
      } else {
        console.log('[DoorDash Wrapped] Received order data from page:', event.data);
      }

      // Forward to background script
      chrome.runtime.sendMessage({
        type: messageType,
        payload: payload
      }).catch(err => {
        console.error('[DoorDash Wrapped] Error sending message to background:', err);
      });
    }
  });
})();
