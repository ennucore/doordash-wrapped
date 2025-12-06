// Background service worker - handles data storage and processing
console.log('[DoorDash Wrapped] Background service worker initialized');

// Helper function to normalize order data from DoorDash GraphQL response
function normalizeOrders(rawData) {
  try {
    // DoorDash GraphQL structure: data.getConsumerOrdersWithDetails is directly an array
    let orders = [];

    if (rawData && rawData.data) {
      // getConsumerOrdersWithDetails is the array itself
      if (Array.isArray(rawData.data.getConsumerOrdersWithDetails)) {
        orders = rawData.data.getConsumerOrdersWithDetails;
      } else if (rawData.data.getConsumerOrdersWithDetails && rawData.data.getConsumerOrdersWithDetails.orders) {
        orders = rawData.data.getConsumerOrdersWithDetails.orders;
      } else if (rawData.data.orders) {
        orders = rawData.data.orders;
      }
    }

    // Normalize each order
    return orders.map(order => {
      try {
        // Extract all items from the nested orders array (for group orders)
        let allItems = [];
        if (order.orders && Array.isArray(order.orders)) {
          order.orders.forEach(subOrder => {
            if (subOrder.items && Array.isArray(subOrder.items)) {
              allItems = allItems.concat(subOrder.items);
            }
          });
        }

        // Fallback to direct items if no nested orders
        if (allItems.length === 0 && order.items && Array.isArray(order.items)) {
          allItems = order.items;
        }

        // Extract delivery address if available
        let deliveryAddress = null;
        if (order.deliveryAddress) {
          deliveryAddress = {
            lat: order.deliveryAddress.lat || order.deliveryAddress.latitude,
            lng: order.deliveryAddress.lng || order.deliveryAddress.longitude,
            street: order.deliveryAddress.street,
            city: order.deliveryAddress.city,
            state: order.deliveryAddress.state,
            zipCode: order.deliveryAddress.zipCode,
            printableAddress: order.deliveryAddress.printableAddress ||
              `${order.deliveryAddress.street || ''}, ${order.deliveryAddress.city || ''}, ${order.deliveryAddress.state || ''}`.trim()
          };
        }

        return {
          id: order.id || order.orderUuid || order.orderId || String(Math.random()),
          restaurantName: order.store?.name || order.storeName || order.restaurantName || 'Unknown Restaurant',
          createdAt: order.createdAt || order.submittedAt || new Date().toISOString(),
          totalPrice: order.grandTotal?.unitAmount || order.totalPrice || 0,
          currency: order.grandTotal?.currency || 'USD',
          deliveryAddress: deliveryAddress,
          items: allItems.map(item => ({
            name: item.name || item.itemName || 'Unknown Item',
            quantity: item.quantity || 1,
            price: item.originalItemPrice || item.substitutionPrice?.unitAmount || item.price?.unitAmount || item.price || 0
          }))
        };
      } catch (err) {
        console.error('[DoorDash Wrapped] Error normalizing order:', err, order);
        return null;
      }
    }).filter(order => order !== null);
  } catch (err) {
    console.error('[DoorDash Wrapped] Error in normalizeOrders:', err);
    return [];
  }
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[DoorDash Wrapped] Received message:', message);

  if (message.type === 'DD_ADDRESSES') {
    const payload = message.payload;

    // Store address data
    chrome.storage.local.get(['dd_addresses'], (result) => {
      const addresses = payload.data?.data?.getAvailableAddresses || [];

      chrome.storage.local.set({
        dd_addresses: addresses
      }, () => {
        console.log('[DoorDash Wrapped] Stored address data:', addresses.length);
      });
    });

    sendResponse({ success: true });
  } else if (message.type === 'DD_ORDERS') {
    const payload = message.payload;

    // Get existing data
    chrome.storage.local.get(['dd_orders_history', 'dd_normalized_orders'], (result) => {
      // Store raw snapshot
      const history = result.dd_orders_history || [];
      const snapshot = {
        ts: Date.now(),
        sourceType: payload.type,
        url: payload.url,
        raw: payload.data
      };
      history.push(snapshot);

      // Normalize and merge orders
      const newOrders = normalizeOrders(payload.data);
      const existingOrders = result.dd_normalized_orders || [];

      // Deduplicate by order ID - keep the newer version if duplicate IDs exist
      const orderMap = new Map();
      let duplicateCount = 0;

      existingOrders.forEach(order => {
        orderMap.set(order.id, order);
      });

      newOrders.forEach(order => {
        if (orderMap.has(order.id)) {
          duplicateCount++;
          // Keep the version with more complete data (prefer non-null deliveryAddress)
          const existing = orderMap.get(order.id);
          if (!existing.deliveryAddress && order.deliveryAddress) {
            orderMap.set(order.id, order);
          }
        } else {
          orderMap.set(order.id, order);
        }
      });

      const mergedOrders = Array.from(orderMap.values()).sort((a, b) =>
        new Date(b.createdAt) - new Date(a.createdAt)
      );

      if (duplicateCount > 0) {
        console.log(`[DoorDash Wrapped] Found and deduplicated ${duplicateCount} duplicate orders`);
      }

      // Save to storage
      chrome.storage.local.set({
        dd_orders_history: history,
        dd_normalized_orders: mergedOrders
      }, () => {
        console.log('[DoorDash Wrapped] Stored data:', {
          totalSnapshots: history.length,
          totalOrders: mergedOrders.length,
          newOrders: newOrders.length
        });
      });
    });

    sendResponse({ success: true });
  }

  return true; // Keep the message channel open for async response
});

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[DoorDash Wrapped] Extension installed/updated:', details.reason);
});
