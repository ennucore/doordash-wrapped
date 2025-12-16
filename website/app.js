// DoorDash Wrapped - Main Application
import { parseDoordashEmail, parseMultipleEmails } from './email-parser.js';

// Google API configuration
const GOOGLE_CLIENT_ID = '763048176504-mvr3nj646ars9d8ip8buegffcrupv646.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';

// State
let currentSlide = 0;
let totalSlides = 9;
let orders = [];
let stats = null;
let tokenClient = null;
let accessToken = null;

// DOM Elements
const pages = {
  landing: document.getElementById('landing-page'),
  loading: document.getElementById('loading-page'),
  noData: document.getElementById('no-data-page'),
  wrapped: document.getElementById('wrapped-page')
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
});

function initializeApp() {
  // Initialize Google Identity Services
  if (typeof google !== 'undefined' && google.accounts) {
    initializeGoogleAuth();
  } else {
    // Wait for Google script to load
    window.addEventListener('load', () => {
      if (typeof google !== 'undefined' && google.accounts) {
        initializeGoogleAuth();
      }
    });
  }

  // Setup event listeners
  document.getElementById('connect-gmail-btn').addEventListener('click', handleConnectGmail);
  document.getElementById('try-again-btn').addEventListener('click', handleTryAgain);
  document.getElementById('download-btn').addEventListener('click', handleDownload);

  // Check for demo mode (for development without Google API)
  if (window.location.search.includes('demo')) {
    loadDemoData();
  }
}

function initializeGoogleAuth() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    callback: handleAuthCallback,
  });
}

function handleConnectGmail() {
  if (window.location.search.includes('demo')) {
    loadDemoData();
    return;
  }

  if (tokenClient) {
    tokenClient.requestAccessToken();
  } else {
    console.error('Google auth not initialized');
    // Fallback to demo mode if auth not ready
    loadDemoData();
  }
}

function handleAuthCallback(response) {
  if (response.error) {
    console.error('Auth error:', response.error);
    return;
  }

  accessToken = response.access_token;
  showPage('loading');
  fetchDoordashEmails();
}

async function fetchDoordashEmails() {
  const loadingText = document.getElementById('loading-text');
  const loadingStatus = document.getElementById('loading-status');
  const progressBar = document.getElementById('loading-progress-bar');

  try {
    loadingText.textContent = 'Searching for DoorDash emails...';
    progressBar.style.width = '20%';

    // Search for DoorDash emails
    const searchQuery = '(in:anywhere OR in:spam OR in:trash) from:doordash (subject:"receipt" OR subject:"confirmation") after:2024/12/31 before:2026/01/01';
    const searchResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(searchQuery)}&maxResults=500`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    const searchData = await searchResponse.json();
    const messageIds = searchData.messages || [];

    if (messageIds.length === 0) {
      showPage('noData');
      return;
    }

    loadingText.textContent = `Found ${messageIds.length} emails. Processing...`;
    progressBar.style.width = '40%';

    // Fetch emails in parallel batches for speed
    const BATCH_SIZE = 20;
    const rawEmails = [];

    for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
      const batch = messageIds.slice(i, i + BATCH_SIZE);
      const progress = 40 + (i / messageIds.length) * 50;
      progressBar.style.width = `${progress}%`;
      loadingStatus.textContent = `Processing emails ${i + 1}-${Math.min(i + BATCH_SIZE, messageIds.length)} of ${messageIds.length}`;

      const batchResults = await Promise.all(
        batch.map(async (msg) => {
          const msgResponse = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=raw`,
            {
              headers: { Authorization: `Bearer ${accessToken}` }
            }
          );
          return msgResponse.json();
        })
      );

      for (const msgData of batchResults) {
        if (msgData.raw) {
          const rawEmail = atob(msgData.raw.replace(/-/g, '+').replace(/_/g, '/'));
          rawEmails.push(rawEmail);
        }
      }
    }

    loadingText.textContent = 'Analyzing your orders...';
    progressBar.style.width = '95%';

    // Parse emails
    orders = parseMultipleEmails(rawEmails);

    if (orders.length === 0) {
      showPage('noData');
      return;
    }

    progressBar.style.width = '100%';
    loadingText.textContent = 'Creating your Wrapped...';

    // Compute stats and show wrapped
    stats = computeStats(orders);
    populateWrapped(stats);
    showPage('wrapped');

  } catch (error) {
    console.error('Error fetching emails:', error);
    loadingText.textContent = 'Error fetching emails';
    loadingStatus.textContent = error.message;
  }
}

async function loadDemoData() {
  showPage('loading');
  const loadingText = document.getElementById('loading-text');
  const progressBar = document.getElementById('loading-progress-bar');

  loadingText.textContent = 'Loading demo data...';
  progressBar.style.width = '50%';

  // Generate demo orders
  orders = generateDemoOrders();

  await new Promise(resolve => setTimeout(resolve, 1000));
  progressBar.style.width = '100%';

  stats = computeStats(orders);
  populateWrapped(stats);
  showPage('wrapped');
}

function generateDemoOrders() {
  const restaurants = [
    'Chipotle Mexican Grill', 'Panda Express', 'Five Guys', 'Sweetgreen',
    'Chick-fil-A', 'Shake Shack', 'Taco Bell', 'McDonald\'s', 'Starbucks',
    'Domino\'s Pizza', 'Subway', 'Panera Bread', 'In-N-Out Burger'
  ];

  const items = [
    { name: 'Chicken Burrito Bowl', price: 1299 },
    { name: 'Orange Chicken', price: 1199 },
    { name: 'Bacon Cheeseburger', price: 1549 },
    { name: 'Harvest Bowl', price: 1399 },
    { name: 'Spicy Deluxe Sandwich', price: 899 },
    { name: 'ShackBurger', price: 1249 },
    { name: 'Crunchwrap Supreme', price: 649 },
    { name: 'Big Mac', price: 749 },
    { name: 'Caramel Frappuccino', price: 699 },
    { name: 'Pepperoni Pizza', price: 1599 },
    { name: 'Italian BMT', price: 899 },
    { name: 'Broccoli Cheddar Soup', price: 799 },
    { name: 'Double-Double', price: 549 }
  ];

  const addresses = [
    '123 Main St, San Francisco, CA 94102, USA',
    '456 Market St, San Francisco, CA 94103, USA',
    '789 Mission St, San Francisco, CA 94105, USA'
  ];

  const demoOrders = [];
  const now = new Date();

  for (let i = 0; i < 47; i++) {
    const daysAgo = Math.floor(Math.random() * 365);
    const date = new Date(now - daysAgo * 24 * 60 * 60 * 1000);
    const restaurant = restaurants[Math.floor(Math.random() * restaurants.length)];
    const numItems = Math.floor(Math.random() * 3) + 1;
    const orderItems = [];

    for (let j = 0; j < numItems; j++) {
      const item = items[Math.floor(Math.random() * items.length)];
      orderItems.push({
        name: item.name,
        quantity: Math.floor(Math.random() * 2) + 1,
        price: item.price
      });
    }

    const subtotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const tax = Math.round(subtotal * 0.0875);
    const deliveryFee = Math.random() > 0.3 ? 0 : 399;
    const serviceFee = Math.round(subtotal * 0.15);
    const tip = Math.round(subtotal * (0.15 + Math.random() * 0.1));
    const total = subtotal + tax + deliveryFee + serviceFee + tip;

    demoOrders.push({
      id: `demo-${i}`,
      restaurantName: restaurant,
      createdAt: date.toISOString(),
      items: orderItems,
      totalPrice: total,
      deliveryAddress: {
        printableAddress: addresses[Math.floor(Math.random() * addresses.length)]
      },
      fees: {
        subtotal,
        tax,
        deliveryFee,
        serviceFee,
        tip
      }
    });
  }

  return demoOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function computeStats(orders) {
  const totalOrders = orders.length;
  const totalSpent = orders.reduce((sum, order) => sum + (order.totalPrice / 100), 0);
  const avgOrder = totalOrders > 0 ? totalSpent / totalOrders : 0;

  // Total items
  const totalItems = orders.reduce((sum, order) =>
    sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0
  );

  // Total tips
  const totalTips = orders.reduce((sum, order) =>
    sum + ((order.fees?.tip || 0) / 100), 0
  );

  // Restaurant stats
  const restaurantCounts = {};
  orders.forEach(order => {
    const name = order.restaurantName;
    restaurantCounts[name] = (restaurantCounts[name] || 0) + 1;
  });

  const topRestaurants = Object.entries(restaurantCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const uniqueRestaurants = Object.keys(restaurantCounts).length;

  // Item stats
  const itemCounts = {};
  orders.forEach(order => {
    order.items.forEach(item => {
      const name = item.name;
      itemCounts[name] = (itemCounts[name] || 0) + item.quantity;
    });
  });

  const topItems = Object.entries(itemCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Timing stats
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayCounts = {};
  const hourCounts = {};
  const monthCounts = {};
  const activityMap = {};

  orders.forEach(order => {
    const date = new Date(order.createdAt);
    const day = dayNames[date.getDay()];
    const hour = date.getHours();
    const month = monthNames[date.getMonth()];

    dayCounts[day] = (dayCounts[day] || 0) + 1;
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    monthCounts[month] = (monthCounts[month] || 0) + 1;

    const key = `${date.getDay()}-${hour}`;
    activityMap[key] = (activityMap[key] || 0) + 1;
  });

  const topDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];
  const topHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
  const topMonth = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0];

  // Price extremes
  const ordersWithPrice = orders.filter(order => order.totalPrice > 0);
  const maxOrder = ordersWithPrice.reduce((max, order) =>
    order.totalPrice > max.totalPrice ? order : max, ordersWithPrice[0]);
  const minOrder = ordersWithPrice.reduce((min, order) =>
    order.totalPrice < min.totalPrice ? order : min, ordersWithPrice[0]);

  // Location stats
  const locationCounts = {};
  orders.forEach(order => {
    if (order.deliveryAddress?.printableAddress) {
      const addr = order.deliveryAddress.printableAddress;
      locationCounts[addr] = (locationCounts[addr] || 0) + 1;
    }
  });

  const topLocations = Object.entries(locationCounts)
    .map(([address, count]) => ({ address, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return {
    totalOrders,
    totalSpent,
    avgOrder,
    totalItems,
    totalTips,
    topRestaurants,
    uniqueRestaurants,
    topItems,
    topDay: topDay ? { name: topDay[0], count: topDay[1] } : null,
    topHour: topHour ? { hour: parseInt(topHour[0]), count: topHour[1] } : null,
    topMonth: topMonth ? { name: topMonth[0], count: topMonth[1] } : null,
    activityMap,
    maxOrder,
    minOrder,
    uniqueLocations: Object.keys(locationCounts).length,
    topLocations
  };
}

function populateWrapped(stats) {
  // Slide 1: Total Spending
  document.getElementById('total-spent-display').textContent =
    '$' + stats.totalSpent.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  document.getElementById('total-orders-display').textContent = stats.totalOrders;

  // Spending tier
  let emoji = '🍔';
  let description = '';
  if (stats.totalSpent < 500) {
    emoji = '🍕';
    description = 'Casual orderer - just getting started!';
  } else if (stats.totalSpent < 1500) {
    emoji = '🍔';
    description = 'Regular customer - food delivery enthusiast!';
  } else if (stats.totalSpent < 3000) {
    emoji = '🍜';
    description = 'Power user - you really love food delivery!';
  } else if (stats.totalSpent < 5000) {
    emoji = '🍱';
    description = 'VIP status - DoorDash loves you!';
  } else {
    emoji = '👑';
    description = 'Legendary - keeping restaurants in business!';
  }
  document.getElementById('spending-emoji').textContent = emoji;
  document.getElementById('spending-description').textContent = description;

  // Slide 2: Average Order
  document.getElementById('avg-order-display').textContent = '$' + stats.avgOrder.toFixed(2);
  document.getElementById('max-order-display').textContent = '$' + (stats.maxOrder.totalPrice / 100).toFixed(2);
  document.getElementById('max-order-restaurant').textContent = stats.maxOrder.restaurantName;
  document.getElementById('min-order-display').textContent = '$' + (stats.minOrder.totalPrice / 100).toFixed(2);
  document.getElementById('min-order-restaurant').textContent = stats.minOrder.restaurantName;

  // Slide 3: Top Restaurant
  if (stats.topRestaurants.length > 0) {
    document.getElementById('top-restaurant-name').textContent = stats.topRestaurants[0].name;
    document.getElementById('top-restaurant-count').textContent = stats.topRestaurants[0].count;

    const restaurantsList = document.getElementById('restaurants-list');
    restaurantsList.innerHTML = '';
    stats.topRestaurants.forEach((restaurant, index) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="rank-number">${index + 1}</span>
        <span class="rank-name">${escapeHtml(restaurant.name)}</span>
        <span class="rank-value">${restaurant.count}x</span>
      `;
      restaurantsList.appendChild(li);
    });
  }

  // Slide 4: Timing
  if (stats.topDay) {
    document.getElementById('peak-day').textContent = stats.topDay.name;
  }
  if (stats.topHour) {
    const hour = stats.topHour.hour;
    const hourStr = hour === 0 ? '12AM' : hour === 12 ? '12PM' : hour < 12 ? `${hour}AM` : `${hour - 12}PM`;
    document.getElementById('peak-hour').textContent = hourStr;
  }

  renderHeatmap(stats.activityMap);

  // Slide 5: Top Items
  if (stats.topItems.length > 0) {
    document.getElementById('top-item-name').textContent = stats.topItems[0].name;
    document.getElementById('top-item-count').textContent = stats.topItems[0].count;

    const itemsList = document.getElementById('items-list');
    itemsList.innerHTML = '';
    stats.topItems.slice(1).forEach((item, index) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="rank-number">${index + 2}</span>
        <span class="rank-name">${escapeHtml(item.name)}</span>
        <span class="rank-value">${item.count}x</span>
      `;
      itemsList.appendChild(li);
    });
  }

  // Slide 6: Delivery
  document.getElementById('locations-count').textContent = stats.uniqueLocations;
  if (stats.topLocations.length > 0) {
    let addr = stats.topLocations[0].address;
    if (addr.length > 50) addr = addr.substring(0, 50) + '...';
    document.getElementById('top-address').textContent = addr;
  }

  // Slide 7: Fun Facts
  if (stats.topMonth) {
    document.getElementById('busiest-month').textContent = stats.topMonth.name;
  }
  document.getElementById('total-items').textContent = stats.totalItems;
  document.getElementById('total-tips').textContent = '$' + stats.totalTips.toFixed(0);
  document.getElementById('unique-restaurants').textContent = stats.uniqueRestaurants;

  // Share card
  document.getElementById('share-spent').textContent =
    '$' + stats.totalSpent.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  document.getElementById('share-orders').textContent = stats.totalOrders;
  document.getElementById('share-restaurant').textContent =
    stats.topRestaurants.length > 0 ? stats.topRestaurants[0].name : 'N/A';

  // Setup navigation
  setupNavigation();
  setupProgressBar();
}

function renderHeatmap(activityMap) {
  const container = document.getElementById('activity-heatmap');
  container.innerHTML = '';

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxValue = Math.max(...Object.values(activityMap), 1);

  // Empty corner
  container.appendChild(document.createElement('div'));

  // Hour labels (every 4 hours)
  for (let hour = 0; hour < 24; hour++) {
    const label = document.createElement('div');
    label.className = 'heatmap-hour-label';
    if (hour % 4 === 0) {
      label.textContent = hour === 0 ? '12a' : hour === 12 ? '12p' : hour < 12 ? hour : hour - 12;
    }
    container.appendChild(label);
  }

  // Day rows
  for (let day = 0; day < 7; day++) {
    const label = document.createElement('div');
    label.className = 'heatmap-label';
    label.textContent = dayLabels[day];
    container.appendChild(label);

    for (let hour = 0; hour < 24; hour++) {
      const key = `${day}-${hour}`;
      const count = activityMap[key] || 0;
      const intensity = Math.min(Math.floor((count / maxValue) * 8), 7);

      const cell = document.createElement('div');
      cell.className = `heatmap-cell heatmap-cell-${intensity}`;
      cell.title = `${dayLabels[day]} ${hour}:00 - ${count} order${count !== 1 ? 's' : ''}`;
      container.appendChild(cell);
    }
  }
}

function setupNavigation() {
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');

  prevBtn.addEventListener('click', () => {
    if (currentSlide > 0) goToSlide(currentSlide - 1);
  });

  nextBtn.addEventListener('click', () => {
    if (currentSlide < totalSlides - 1) goToSlide(currentSlide + 1);
  });

  // Click anywhere to advance
  document.querySelector('.slides-wrapper').addEventListener('click', (e) => {
    if (!e.target.closest('.nav-btn') && !e.target.closest('.share-btn') && !e.target.closest('.secondary-button')) {
      if (currentSlide < totalSlides - 1) goToSlide(currentSlide + 1);
    }
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' && currentSlide > 0) goToSlide(currentSlide - 1);
    if (e.key === 'ArrowRight' && currentSlide < totalSlides - 1) goToSlide(currentSlide + 1);
  });
}

function goToSlide(slideIndex) {
  const slides = document.querySelectorAll('.slide');

  slides.forEach(slide => slide.classList.remove('active', 'prev'));

  if (slideIndex > currentSlide) {
    slides[currentSlide].classList.add('prev');
  }

  slides[slideIndex].classList.add('active');
  currentSlide = slideIndex;

  document.getElementById('prev-btn').disabled = currentSlide === 0;
  document.getElementById('next-btn').disabled = currentSlide === totalSlides - 1;

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

function showPage(pageName) {
  Object.values(pages).forEach(page => page.classList.remove('active'));
  pages[pageName].classList.add('active');
}

function handleTryAgain() {
  showPage('landing');
}

async function handleDownload() {
  const shareCard = document.getElementById('share-card');

  if (typeof html2canvas !== 'undefined') {
    const canvas = await html2canvas(shareCard, {
      backgroundColor: null,
      scale: 2
    });

    const link = document.createElement('a');
    link.download = 'doordash-wrapped-2025.png';
    link.href = canvas.toDataURL();
    link.click();
  } else {
    alert('Screenshot feature not available. Please try again later.');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
