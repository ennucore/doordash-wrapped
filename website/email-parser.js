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
  // Remove soft line breaks first
  str = str.replace(/=\r?\n/g, '');

  // Decode quoted-printable to bytes, then decode as UTF-8
  const bytes = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] === '=' && i + 2 < str.length && /[0-9A-Fa-f]{2}/.test(str.slice(i + 1, i + 3))) {
      bytes.push(parseInt(str.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      bytes.push(str.charCodeAt(i));
      i++;
    }
  }

  // Decode bytes as UTF-8
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
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

export function getHtmlPart(rawEmail) {
  // Find the text/html part of the multipart email
  const boundaryMatch = rawEmail.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) {
    return '';
  }

  let boundary = boundaryMatch[1].replace(/"/g, '');
  const parts = rawEmail.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  for (const part of parts) {
    if (part.includes('Content-Type: text/html') || part.includes('content-type: text/html')) {
      const contentStart = part.search(/\r?\n\r?\n/);
      if (contentStart !== -1) {
        let content = part.slice(contentStart + 2);
        if (part.includes('quoted-printable')) {
          content = decodeQuotedPrintable(content);
        }
        return content;
      }
    }
  }

  return '';
}

export function extractItems(htmlContent) {
  const items = [];

  // Pattern: <strong>7x</strong> Item Name</p> ... $XX.XX
  const itemPattern = /<strong>(\d+)x<\/strong>\s*([^<]+)<\/p>[\s\S]*?>\s*&nbsp;\$?([\d,]+\.\d{2})&nbsp;</g;

  let match;
  while ((match = itemPattern.exec(htmlContent)) !== null) {
    const quantity = parseInt(match[1], 10);
    let name = match[2].trim();
    const price = parseFloat(match[3].replace(',', ''));

    // Clean up HTML entities
    name = name.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

    if (name && !isNaN(price) && price > 0) {
      items.push({
        name,
        quantity,
        price: Math.round(price * 100)
      });
    }
  }

  return items;
}

export function extractTotal(htmlContent) {
  // Pattern: Final total charged ... $XX.XX or Total: $XX.XX
  const patterns = [
    /Final total charged[\s\S]*?\$?([\d,]+\.\d{2})/i,
    /Total:[\s\S]*?\$?([\d,]+\.\d{2})/i
  ];

  for (const pattern of patterns) {
    const match = htmlContent.match(pattern);
    if (match) {
      return Math.round(parseFloat(match[1].replace(',', '')) * 100);
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

export function extractFees(htmlContent) {
  const fees = {
    subtotal: 0,
    tax: 0,
    deliveryFee: 0,
    serviceFee: 0,
    tip: 0
  };

  // Helper to extract fee from HTML table structure
  // Pattern: <p class="p2">Fee Name</p></td> ... <p class="p2">$XX.XX</p>
  const extractFee = (name) => {
    const pattern = new RegExp(name + '[^<]*</p></td>[\\s\\S]*?<p[^>]*>\\$([\\d,]+\\.\\d{2})</p>', 'i');
    const match = htmlContent.match(pattern);
    if (match) {
      return Math.round(parseFloat(match[1].replace(',', '')) * 100);
    }
    return 0;
  };

  fees.subtotal = extractFee('Subtotal');
  fees.tax = extractFee('Tax');
  fees.deliveryFee = extractFee('Delivery fee');
  fees.serviceFee = extractFee('Service.*?fee');
  fees.tip = extractFee('(?:Dasher.*?)?tip');

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

  const htmlContent = getHtmlPart(rawEmail);
  const textContent = getPlainTextPart(rawEmail);

  const items = extractItems(htmlContent);
  const totalPrice = extractTotal(htmlContent);
  const fees = extractFees(htmlContent);
  const deliveryAddress = extractAddress(textContent);

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
