// Email parser for DoorDash receipts
// Parses email content to extract order information

export function parseEmailHeaders(rawEmail) {
  const headers = {};
  const headerSection = rawEmail.split(/\r?\n\r?\n/)[0];

  // Handle multi-line headers (lines starting with whitespace are continuations)
  const normalizedHeaders = headerSection.replace(/\r?\n[ \t]+/g, ' ');

  const lines = normalizedHeaders.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      const key = match[1].toLowerCase();
      headers[key] = match[2];
    }
  }

  return headers;
}

export function parseDate(dateString) {
  // Parse email date format: "Sun, 14 Dec 2025 01:12:45 +0000 (UTC)"
  const date = new Date(dateString);
  return isNaN(date.getTime()) ? null : date;
}

export function extractRestaurantFromSubject(subject) {
  // Patterns:
  // "Final receipt for Lev from Target"
  // "Order Confirmation for Lev from Bimi Poke"
  const patterns = [
    /Final receipt for .+ from (.+)$/i,
    /Order Confirmation for .+ from (.+)$/i,
    /Your .+ order from (.+)$/i,
    /Receipt from (.+)$/i
  ];

  for (const pattern of patterns) {
    const match = subject.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

export function decodeQuotedPrintable(str) {
  // Decode quoted-printable encoding
  return str
    .replace(/=\r?\n/g, '') // Remove soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function getPlainTextPart(rawEmail) {
  // Find the text/plain part of the multipart email
  const boundaryMatch = rawEmail.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) {
    // Not multipart, try to get content after headers
    const parts = rawEmail.split(/\r?\n\r?\n/);
    return parts.slice(1).join('\n\n');
  }

  let boundary = boundaryMatch[1].replace(/"/g, '');

  // Split by boundary
  const parts = rawEmail.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  // Find the text/plain part
  for (const part of parts) {
    if (part.includes('Content-Type: text/plain') || part.includes('content-type: text/plain')) {
      // Get content after the headers in this part
      const contentStart = part.search(/\r?\n\r?\n/);
      if (contentStart !== -1) {
        let content = part.slice(contentStart + 2);
        // Decode if quoted-printable
        if (part.includes('quoted-printable')) {
          content = decodeQuotedPrintable(content);
        }
        return content;
      }
    }
  }

  return '';
}

export function extractItems(textContent) {
  const items = [];

  // Pattern to match items like "1x Optimum Nutrition Micronized Blueberry Lemonade Creatine Powder (12.69 oz)"
  // followed by price like "$28.19"
  const itemPatterns = [
    // "1x Item Name" followed eventually by "$XX.XX"
    /(\d+)x\s+([^\n$]+?)\s*\$?([\d,]+\.?\d*)/g,
    // Alternative pattern for items listed differently
    /(\d+)\s*×\s*([^\n$]+?)\s*\$?([\d,]+\.?\d*)/g
  ];

  for (const pattern of itemPatterns) {
    let match;
    while ((match = pattern.exec(textContent)) !== null) {
      const quantity = parseInt(match[1], 10);
      let name = match[2].trim();
      const price = parseFloat(match[3].replace(',', ''));

      // Clean up the item name
      name = name.replace(/\s+/g, ' ').trim();
      // Remove trailing non-alphanumeric chars except )
      name = name.replace(/[^a-zA-Z0-9)\s]+$/, '').trim();

      if (name && !isNaN(price) && price > 0) {
        items.push({
          name,
          quantity,
          price: Math.round(price * 100) // Store in cents
        });
      }
    }
  }

  return items;
}

export function extractTotal(textContent) {
  // Look for various total patterns
  const patterns = [
    /Final total charged\s*\$?([\d,]+\.?\d*)/i,
    /Total:\s*\$?([\d,]+\.?\d*)/i,
    /ESTIMATED TOTAL:\s*\$?([\d,]+\.?\d*)/i,
    /Grand Total\s*\$?([\d,]+\.?\d*)/i,
    /Order Total\s*\$?([\d,]+\.?\d*)/i
  ];

  for (const pattern of patterns) {
    const match = textContent.match(pattern);
    if (match) {
      return Math.round(parseFloat(match[1].replace(',', '')) * 100); // Return in cents
    }
  }

  return 0;
}

export function extractAddress(textContent) {
  // Look for address patterns
  // Common pattern: "1 Arkansas St #41, San Francisco, CA 94107, USA"
  const patterns = [
    /Your receipt\s+(.+?,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?,?\s*USA?)/i,
    /Deliver(?:ed)? to[:\s]+(.+?,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)/i,
    /(\d+[^,\n]+,\s*[^,\n]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?,?\s*USA?)/i
  ];

  for (const pattern of patterns) {
    const match = textContent.match(pattern);
    if (match) {
      return match[1].trim().replace(/\s+/g, ' ');
    }
  }

  return null;
}

export function extractFees(textContent) {
  const fees = {
    subtotal: 0,
    tax: 0,
    deliveryFee: 0,
    serviceFee: 0,
    tip: 0
  };

  // Subtotal
  const subtotalMatch = textContent.match(/Subtotal\s*\$?([\d,]+\.?\d*)/i);
  if (subtotalMatch) {
    fees.subtotal = Math.round(parseFloat(subtotalMatch[1].replace(',', '')) * 100);
  }

  // Tax
  const taxMatch = textContent.match(/Tax\s*\$?([\d,]+\.?\d*)/i);
  if (taxMatch) {
    fees.tax = Math.round(parseFloat(taxMatch[1].replace(',', '')) * 100);
  }

  // Delivery fee
  const deliveryMatch = textContent.match(/Delivery fee\s*\$?([\d,]+\.?\d*)/i);
  if (deliveryMatch) {
    fees.deliveryFee = Math.round(parseFloat(deliveryMatch[1].replace(',', '')) * 100);
  }

  // Service fee
  const serviceMatch = textContent.match(/Service\s*fee\s*\$?([\d,]+\.?\d*)/i);
  if (serviceMatch) {
    fees.serviceFee = Math.round(parseFloat(serviceMatch[1].replace(',', '')) * 100);
  }

  // Tip
  const tipMatch = textContent.match(/(?:Dasher\s*)?tip\s*\$?([\d,]+\.?\d*)/i);
  if (tipMatch) {
    fees.tip = Math.round(parseFloat(tipMatch[1].replace(',', '')) * 100);
  }

  return fees;
}

export function parseDoordashEmail(rawEmail) {
  const headers = parseEmailHeaders(rawEmail);
  const date = parseDate(headers.date);
  const subject = headers.subject || '';
  const restaurantName = extractRestaurantFromSubject(subject);

  // Check if this is from DoorDash
  const from = headers.from || '';
  if (!from.toLowerCase().includes('doordash')) {
    return null;
  }

  const textContent = getPlainTextPart(rawEmail);
  const items = extractItems(textContent);
  const totalPrice = extractTotal(textContent);
  const deliveryAddress = extractAddress(textContent);
  const fees = extractFees(textContent);

  // Generate a unique ID from the message-id header or date+restaurant
  const messageId = headers['message-id'] || `${date?.getTime()}-${restaurantName}`;
  const id = messageId.replace(/[^a-zA-Z0-9]/g, '');

  return {
    id,
    restaurantName,
    createdAt: date?.toISOString(),
    items,
    totalPrice,
    deliveryAddress: deliveryAddress ? { printableAddress: deliveryAddress } : null,
    fees,
    subject,
    emailType: subject.toLowerCase().includes('final receipt') ? 'final_receipt' :
               subject.toLowerCase().includes('confirmation') ? 'confirmation' : 'other'
  };
}

export function parseMultipleEmails(rawEmails) {
  const orders = [];
  const seen = new Set();

  for (const rawEmail of rawEmails) {
    const order = parseDoordashEmail(rawEmail);
    if (order && order.restaurantName && !seen.has(order.id)) {
      seen.add(order.id);
      orders.push(order);
    }
  }

  // Sort by date, newest first
  orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return orders;
}
