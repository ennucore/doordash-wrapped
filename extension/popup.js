// Popup script - Story format
let currentSlide = 0;
let totalSlides = 8;
let stats = null;

document.addEventListener('DOMContentLoaded', () => {
  console.log('[DoorDash Wrapped] Popup loaded');

  // Load data from storage - get both normalized orders and raw history
  chrome.storage.local.get(['dd_normalized_orders', 'dd_orders_history'], (result) => {
    const orders = result.dd_normalized_orders || [];
    const history = result.dd_orders_history || [];
    console.log('[DoorDash Wrapped] Loaded orders:', orders.length);

    // Hide loading
    document.getElementById('loading').style.display = 'none';

    if (orders.length === 0) {
      document.getElementById('no-data').style.display = 'flex';
      return;
    }

    // Compute all stats (pass both orders and history)
    stats = computeAllStats(orders, history);

    // Populate slides
    populateSlides(stats);

    // Show story container
    document.getElementById('story-container').classList.add('active');

    // Show fullscreen button
    const fullscreenBtn = document.getElementById('open-fullscreen-btn');
    fullscreenBtn.style.display = 'block';
    fullscreenBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('wrapped.html') });
    });

    // Setup navigation
    setupNavigation();

    // Setup progress bar
    setupProgressBar();
  });
});

function computeAllStats(orders, history) {
  // Basic stats
  const totalOrders = orders.length;
  const totalSpent = orders.reduce((sum, order) => sum + (order.totalPrice / 100), 0);
  const avgOrder = totalOrders > 0 ? totalSpent / totalOrders : 0;
  const totalItems = orders.reduce((sum, order) =>
    sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0
  );

  // Top restaurants
  const restaurantCounts = {};
  orders.forEach(order => {
    const name = order.restaurantName;
    restaurantCounts[name] = (restaurantCounts[name] || 0) + 1;
  });
  const topRestaurants = Object.entries(restaurantCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Group orders - check the raw data for group orders
  let groupOrders = [];
  let friendStats = {}; // Track orders, spending, and dishes per friend
  let currentUserName = null;

  // First, try to identify the current user from the first order
  history.forEach(snapshot => {
    const data = snapshot.raw?.data?.getConsumerOrdersWithDetails || [];
    data.forEach(order => {
      if (order.creator && !currentUserName) {
        currentUserName = `${order.creator.firstName} ${order.creator.lastName}`;
      }
    });
  });

  history.forEach(snapshot => {
    const data = snapshot.raw?.data?.getConsumerOrdersWithDetails || [];
    data.forEach(order => {
      if (order.isGroup && order.orders) {
        groupOrders.push(order);
        order.orders.forEach(subOrder => {
          if (subOrder.creator) {
            const name = `${subOrder.creator.firstName} ${subOrder.creator.lastName}`;

            // Skip the current user
            if (name === currentUserName) return;

            if (!friendStats[name]) {
              friendStats[name] = {
                orderCount: 0,
                totalSpent: 0,
                dishes: {}
              };
            }

            friendStats[name].orderCount++;

            // Calculate spending for this sub-order
            if (subOrder.items) {
              subOrder.items.forEach(item => {
                const itemPrice = item.originalItemPrice || 0;
                friendStats[name].totalSpent += itemPrice * item.quantity;

                // Track dishes
                const dishName = item.name;
                if (!friendStats[name].dishes[dishName]) {
                  friendStats[name].dishes[dishName] = 0;
                }
                friendStats[name].dishes[dishName] += item.quantity;
              });
            }
          }
        });
      }
    });
  });

  // Convert to array and add favorite dish
  const topFriends = Object.entries(friendStats)
    .map(([name, stats]) => {
      const topDish = Object.entries(stats.dishes)
        .sort((a, b) => b[1] - a[1])[0];

      return {
        name,
        count: stats.orderCount,
        spent: stats.totalSpent / 100, // Convert to dollars
        favoriteDish: topDish ? topDish[0] : 'N/A'
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 3); // Show top 3 friends

  // Days of week and hours - create activity heatmap
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayCounts = {};
  const hourCounts = {};
  const activityMap = {}; // day-hour combination

  orders.forEach(order => {
    const date = new Date(order.createdAt);
    const day = dayNames[date.getDay()];
    const hour = date.getHours();

    dayCounts[day] = (dayCounts[day] || 0) + 1;
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;

    // Create key for day-hour combination
    const key = `${date.getDay()}-${hour}`;
    activityMap[key] = (activityMap[key] || 0) + 1;
  });

  const topDay = Object.entries(dayCounts)
    .sort((a, b) => b[1] - a[1])[0];

  const busiestHour = Object.entries(hourCounts)
    .sort((a, b) => b[1] - a[1])[0];

  // Most active month
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthCounts = {};
  orders.forEach(order => {
    const date = new Date(order.createdAt);
    const month = monthNames[date.getMonth()];
    monthCounts[month] = (monthCounts[month] || 0) + 1;
  });
  const topMonth = Object.entries(monthCounts)
    .sort((a, b) => b[1] - a[1])[0];

  // Top dishes
  const dishCounts = {};
  orders.forEach(order => {
    order.items.forEach(item => {
      const name = item.name;
      if (!dishCounts[name]) {
        dishCounts[name] = { count: 0, totalSpent: 0 };
      }
      dishCounts[name].count += item.quantity;
      dishCounts[name].totalSpent += (item.price * item.quantity) / 100;
    });
  });
  const topDishes = Object.entries(dishCounts)
    .map(([name, data]) => ({ name, count: data.count, spent: data.totalSpent }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Most and least expensive orders
  const ordersWithPrice = orders.map(order => ({
    ...order,
    price: order.totalPrice / 100
  })).filter(order => order.price > 0);

  const mostExpensive = ordersWithPrice.reduce((max, order) =>
    order.price > max.price ? order : max, ordersWithPrice[0] || { price: 0, restaurantName: 'N/A' });

  const leastExpensive = ordersWithPrice.reduce((min, order) =>
    order.price < min.price ? order : min, ordersWithPrice[0] || { price: 0, restaurantName: 'N/A' });

  // Delivery locations
  const locationCounts = {};
  let ordersWithLocation = 0;
  orders.forEach(order => {
    if (order.deliveryAddress && order.deliveryAddress.lat && order.deliveryAddress.lng) {
      ordersWithLocation++;
      const key = `${order.deliveryAddress.lat.toFixed(4)},${order.deliveryAddress.lng.toFixed(4)}`;
      if (!locationCounts[key]) {
        locationCounts[key] = {
          lat: order.deliveryAddress.lat,
          lng: order.deliveryAddress.lng,
          address: order.deliveryAddress.printableAddress || 'Unknown',
          count: 0
        };
      }
      locationCounts[key].count++;
    }
  });

  const topLocations = Object.values(locationCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Calculate distance between furthest locations
  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  let maxDistance = 0;
  let furthestPair = null;
  const locations = Object.values(locationCounts);
  for (let i = 0; i < locations.length; i++) {
    for (let j = i + 1; j < locations.length; j++) {
      const dist = haversineDistance(
        locations[i].lat, locations[i].lng,
        locations[j].lat, locations[j].lng
      );
      if (dist > maxDistance) {
        maxDistance = dist;
        furthestPair = [locations[i], locations[j]];
      }
    }
  }

  return {
    totalOrders,
    totalSpent,
    avgOrder,
    totalItems,
    topRestaurants,
    groupOrdersCount: groupOrders.length,
    topFriends,
    topDay: topDay ? { name: topDay[0], count: topDay[1] } : null,
    busiestHour: busiestHour ? { hour: parseInt(busiestHour[0]), count: busiestHour[1] } : null,
    topMonth: topMonth ? { name: topMonth[0], count: topMonth[1] } : null,
    topDishes,
    mostExpensive,
    leastExpensive,
    activityMap,
    deliveryLocations: {
      uniqueCount: Object.keys(locationCounts).length,
      ordersWithLocation,
      topLocations,
      maxDistance,
      furthestPair
    }
  };
}

function populateSlides(stats) {
  // Slide 2: Orders & Spending
  document.getElementById('total-orders-display').textContent = stats.totalOrders;
  document.getElementById('total-spent-display').textContent = '$' + stats.totalSpent.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });

  // Dynamic description and emoji based on spending
  let emoji = '🍔';
  let description = '';
  if (stats.totalSpent < 500) {
    emoji = '🍕';
    description = 'Just getting started with DoorDash!';
  } else if (stats.totalSpent < 1000) {
    emoji = '🍔';
    description = 'A casual food delivery enthusiast!';
  } else if (stats.totalSpent < 3000) {
    emoji = '🍜';
    description = 'You really love food delivery!';
  } else if (stats.totalSpent < 5000) {
    emoji = '🍱';
    description = 'DoorDash VIP right here!';
  } else {
    emoji = '👑';
    description = 'You\'re basically keeping restaurants in business!';
  }
  document.getElementById('orders-emoji').textContent = emoji;
  document.getElementById('orders-description').textContent = description;

  // Slide 3: Top Restaurants
  const restaurantsList = document.getElementById('top-restaurants-list');
  restaurantsList.innerHTML = '';
  stats.topRestaurants.forEach((restaurant, index) => {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `
      <span class="list-rank">${index + 1}</span>
      <span class="list-name">${escapeHtml(restaurant.name)}</span>
      <span class="list-value">${restaurant.count}×</span>
    `;
    restaurantsList.appendChild(li);
  });

  // Slide 4: Group Orders (hide if none)
  if (stats.groupOrdersCount === 0 || stats.topFriends.length === 0) {
    document.getElementById('group-slide').style.display = 'none';
    // Adjust slide numbers
    document.querySelectorAll('.slide').forEach((slide, index) => {
      if (index > 3) {
        slide.setAttribute('data-slide', parseInt(slide.getAttribute('data-slide')) - 1);
      }
    });
    totalSlides = 6;
  } else {
    document.getElementById('group-orders-count').textContent = stats.groupOrdersCount;
    const friendsList = document.getElementById('top-friends-list');
    friendsList.innerHTML = '';
    stats.topFriends.forEach((friend, index) => {
      const li = document.createElement('li');
      li.className = 'list-item friend-card';
      li.innerHTML = `
        <div class="friend-header">
          <div class="friend-rank-name">
            <div class="friend-rank-circle">${index + 1}</div>
            <div>
              <div class="friend-name">${escapeHtml(friend.name)}</div>
              <div class="friend-orders">${friend.count} order${friend.count !== 1 ? 's' : ''} together</div>
            </div>
          </div>
        </div>
        <div class="friend-stats">
          <div class="friend-stat">
            <div class="friend-stat-value">$${friend.spent.toFixed(2)}</div>
            <div class="friend-stat-label">Total Spent</div>
          </div>
          <div class="friend-divider"></div>
          <div class="friend-stat">
            <div class="friend-stat-value friend-dish">${escapeHtml(truncateDish(friend.favoriteDish))}</div>
            <div class="friend-stat-label">Go-To Order</div>
          </div>
        </div>
      `;
      friendsList.appendChild(li);
    });
  }

  function truncateDish(dish) {
    if (dish.length > 25) {
      return dish.substring(0, 25) + '...';
    }
    return dish;
  }

  // Slide 5: Days & Timing
  if (stats.topDay) {
    document.getElementById('top-day-name').textContent = stats.topDay.name.slice(0, 3);
  }
  if (stats.busiestHour) {
    const hour = stats.busiestHour.hour;
    const hourStr = hour === 0 ? '12AM' : hour === 12 ? '12PM' : hour < 12 ? `${hour}AM` : `${hour - 12}PM`;
    document.getElementById('busiest-hour').textContent = hourStr;
    document.getElementById('timing-description').textContent =
      `Peak ordering: ${stats.topDay.name}s at ${hourStr}`;
  }
  if (stats.topMonth) {
    document.getElementById('top-month-name').textContent = stats.topMonth.name;
  }

  // Render activity heatmap
  renderActivityHeatmap(stats.activityMap);

  // Slide 6: Top Dishes
  const dishesList = document.getElementById('top-dishes-list');
  dishesList.innerHTML = '';
  stats.topDishes.forEach((dish, index) => {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `
      <span class="list-rank">${index + 1}</span>
      <span class="list-name">${escapeHtml(dish.name)}</span>
      <span class="list-value">${dish.count}×</span>
    `;
    dishesList.appendChild(li);
  });

  // Slide 7: Delivery Locations
  if (stats.deliveryLocations.uniqueCount === 0) {
    document.getElementById('delivery-slide').style.display = 'none';
    // Adjust slide numbers
    document.querySelectorAll('.slide').forEach((slide, index) => {
      const slideNum = parseInt(slide.getAttribute('data-slide'));
      if (slideNum > 6) {
        slide.setAttribute('data-slide', slideNum - 1);
      }
    });
    totalSlides = 7;
  } else {
    document.getElementById('unique-locations-count').textContent = stats.deliveryLocations.uniqueCount;
    document.getElementById('max-distance-value').textContent =
      stats.deliveryLocations.maxDistance > 0 ?
        `${stats.deliveryLocations.maxDistance.toFixed(1)} mi` :
        'N/A';

    if (stats.deliveryLocations.furthestPair && stats.deliveryLocations.maxDistance > 0) {
      const pair = stats.deliveryLocations.furthestPair;
      document.getElementById('delivery-description').textContent =
        `Your furthest orders were ${stats.deliveryLocations.maxDistance.toFixed(1)} miles apart!`;
    }

    const locationsList = document.getElementById('delivery-locations-list');
    locationsList.innerHTML = '';
    stats.deliveryLocations.topLocations.forEach((location, index) => {
      const li = document.createElement('li');
      li.className = 'list-item';
      // Truncate address if too long
      let displayAddress = location.address;
      if (displayAddress.length > 35) {
        displayAddress = displayAddress.substring(0, 35) + '...';
      }
      li.innerHTML = `
        <span class="list-rank">${index + 1}</span>
        <span class="list-name" style="font-size: 13px;">${escapeHtml(displayAddress)}</span>
        <span class="list-value">${location.count}×</span>
      `;
      locationsList.appendChild(li);
    });
  }

  // Slide 8: Fun Facts - Most/Least Expensive
  if (stats.mostExpensive) {
    document.getElementById('most-expensive-order').textContent = '$' + stats.mostExpensive.price.toFixed(2);
    document.getElementById('most-expensive-restaurant').textContent = stats.mostExpensive.restaurantName;
  }
  if (stats.leastExpensive) {
    document.getElementById('least-expensive-order').textContent = '$' + stats.leastExpensive.price.toFixed(2);
    document.getElementById('least-expensive-restaurant').textContent = stats.leastExpensive.restaurantName;
  }
  document.getElementById('avg-order-display').textContent = '$' + stats.avgOrder.toFixed(2);

  // Fun fact description
  const priceDiff = stats.mostExpensive.price - stats.leastExpensive.price;
  document.getElementById('fun-fact-description').textContent =
    `Your most expensive order was ${priceDiff.toFixed(0)}× more than your cheapest!`;
}

function setupNavigation() {
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const slides = document.querySelectorAll('.slide');

  prevBtn.addEventListener('click', () => {
    if (currentSlide > 0) {
      goToSlide(currentSlide - 1);
    }
  });

  nextBtn.addEventListener('click', () => {
    if (currentSlide < totalSlides - 1) {
      goToSlide(currentSlide + 1);
    }
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' && currentSlide > 0) {
      goToSlide(currentSlide - 1);
    } else if (e.key === 'ArrowRight' && currentSlide < totalSlides - 1) {
      goToSlide(currentSlide + 1);
    }
  });
}

function goToSlide(slideIndex) {
  const slides = document.querySelectorAll('.slide');

  // Remove active/prev from all slides
  slides.forEach(slide => {
    slide.classList.remove('active', 'prev');
  });

  // Add prev to old slide
  if (slideIndex > currentSlide) {
    slides[currentSlide].classList.add('prev');
  }

  // Add active to new slide
  slides[slideIndex].classList.add('active');

  currentSlide = slideIndex;

  // Update button states
  document.getElementById('prev-btn').disabled = currentSlide === 0;
  document.getElementById('next-btn').disabled = currentSlide === totalSlides - 1;

  // Update progress bar
  updateProgressBar();
}

function setupProgressBar() {
  const progressBar = document.getElementById('progress-bar');
  progressBar.innerHTML = '';

  for (let i = 0; i < totalSlides; i++) {
    const segment = document.createElement('div');
    segment.className = 'progress-segment';
    segment.innerHTML = '<div class="progress-fill"></div>';
    progressBar.appendChild(segment);
  }

  updateProgressBar();
}

function updateProgressBar() {
  const segments = document.querySelectorAll('.progress-segment');
  segments.forEach((segment, index) => {
    segment.classList.remove('active', 'completed');
    if (index < currentSlide) {
      segment.classList.add('completed');
    } else if (index === currentSlide) {
      segment.classList.add('active');
    }
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderActivityHeatmap(activityMap) {
  const container = document.getElementById('activity-heatmap');
  container.innerHTML = '';

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Create container with title
  const heatmapDiv = document.createElement('div');
  heatmapDiv.className = 'heatmap-container';

  const title = document.createElement('div');
  title.className = 'heatmap-title';
  title.textContent = 'Order Activity Heatmap';
  heatmapDiv.appendChild(title);

  // Create grid
  const grid = document.createElement('div');
  grid.className = 'heatmap-grid';

  // Find max value for normalization
  const maxValue = Math.max(...Object.values(activityMap), 1);

  // Add empty corner cell
  const corner = document.createElement('div');
  grid.appendChild(corner);

  // Add hour labels (top row)
  for (let hour = 0; hour < 24; hour++) {
    const hourLabel = document.createElement('div');
    hourLabel.className = 'heatmap-hour-label';
    hourLabel.textContent = hour === 0 ? '12a' : hour === 12 ? '12p' : hour < 12 ? hour : hour - 12;
    grid.appendChild(hourLabel);
  }

  // Add day rows
  for (let day = 0; day < 7; day++) {
    // Day label
    const dayLabel = document.createElement('div');
    dayLabel.className = 'heatmap-label';
    dayLabel.textContent = dayLabels[day];
    grid.appendChild(dayLabel);

    // Hour cells
    for (let hour = 0; hour < 24; hour++) {
      const key = `${day}-${hour}`;
      const count = activityMap[key] || 0;
      const intensity = Math.min(Math.floor((count / maxValue) * 8), 7);

      const cell = document.createElement('div');
      cell.className = `heatmap-cell heatmap-cell-${intensity}`;
      cell.title = `${dayLabels[day]} ${hour}:00 - ${count} order${count !== 1 ? 's' : ''}`;
      grid.appendChild(cell);
    }
  }

  heatmapDiv.appendChild(grid);

  // Add legend
  const legend = document.createElement('div');
  legend.className = 'heatmap-legend';
  legend.innerHTML = '<span>Less</span>';
  for (let i = 0; i <= 7; i++) {
    const item = document.createElement('div');
    item.className = `legend-item heatmap-cell-${i}`;
    legend.appendChild(item);
  }
  legend.innerHTML += '<span>More</span>';
  heatmapDiv.appendChild(legend);

  container.appendChild(heatmapDiv);
}
