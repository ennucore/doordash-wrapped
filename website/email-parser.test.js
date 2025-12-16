// Tests for email parser
import {
  parseEmailHeaders,
  parseDate,
  extractRestaurantFromSubject,
  decodeQuotedPrintable,
  getPlainTextPart,
  extractItems,
  extractTotal,
  extractAddress,
  extractFees,
  parseDoordashEmail,
  parseMultipleEmails
} from './email-parser.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load test emails
const targetEmail = readFileSync(join(__dirname, '../Final receipt for Lev from Target.eml'), 'utf-8');
const bimiPokeEmail = readFileSync(join(__dirname, '../Order Confirmation for Lev from Bimi Poke.eml'), 'utf-8');

// Test helpers
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`\x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (error) {
    console.log(`\x1b[31m✗\x1b[0m ${name}`);
    console.log(`  Error: ${error.message}`);
    failed++;
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toContain(expected) {
      if (!actual.includes(expected)) {
        throw new Error(`Expected "${actual}" to contain "${expected}"`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected ${JSON.stringify(actual)} to be truthy`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
      }
    },
    toBeGreaterThan(expected) {
      if (actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toHaveLength(expected) {
      if (actual.length !== expected) {
        throw new Error(`Expected length ${expected}, got ${actual.length}`);
      }
    }
  };
}

console.log('\n=== Email Parser Tests ===\n');

// Header parsing tests
console.log('--- Header Parsing ---');

test('parseEmailHeaders extracts basic headers', () => {
  const headers = parseEmailHeaders(targetEmail);
  expect(headers.from).toContain('doordash.com');
  expect(headers.to).toBe('ennucore@gmail.com');
  expect(headers.subject).toBe('Final receipt for Lev from Target');
});

test('parseEmailHeaders handles Bimi Poke email', () => {
  const headers = parseEmailHeaders(bimiPokeEmail);
  expect(headers.subject).toBe('Order Confirmation for Lev from Bimi Poke');
});

test('parseDate parses email date format', () => {
  const date = parseDate('Sun, 14 Dec 2025 01:12:45 +0000 (UTC)');
  expect(date).toBeTruthy();
  expect(date.getFullYear()).toBe(2025);
  expect(date.getMonth()).toBe(11); // December
});

// Subject parsing tests
console.log('\n--- Subject Parsing ---');

test('extractRestaurantFromSubject handles "Final receipt" format', () => {
  const restaurant = extractRestaurantFromSubject('Final receipt for Lev from Target');
  expect(restaurant).toBe('Target');
});

test('extractRestaurantFromSubject handles "Order Confirmation" format', () => {
  const restaurant = extractRestaurantFromSubject('Order Confirmation for Lev from Bimi Poke');
  expect(restaurant).toBe('Bimi Poke');
});

test('extractRestaurantFromSubject returns null for unknown format', () => {
  const restaurant = extractRestaurantFromSubject('Random email subject');
  expect(restaurant).toBeNull();
});

// Quoted-printable decoding tests
console.log('\n--- Quoted-Printable Decoding ---');

test('decodeQuotedPrintable decodes basic sequences', () => {
  const decoded = decodeQuotedPrintable('Hello=20World');
  expect(decoded).toBe('Hello World');
});

test('decodeQuotedPrintable handles soft line breaks', () => {
  const decoded = decodeQuotedPrintable('Hello=\nWorld');
  expect(decoded).toBe('HelloWorld');
});

test('decodeQuotedPrintable decodes special chars', () => {
  const decoded = decodeQuotedPrintable('=C2=A0'); // Non-breaking space
  expect(decoded).toBeTruthy();
});

// Content extraction tests
console.log('\n--- Content Extraction ---');

test('getPlainTextPart extracts text from Target email', () => {
  const text = getPlainTextPart(targetEmail);
  expect(text).toContain('Final receipt');
  expect(text).toContain('Target');
});

test('getPlainTextPart extracts text from Bimi Poke email', () => {
  const text = getPlainTextPart(bimiPokeEmail);
  expect(text).toContain('Bimi Poke');
});

// Item extraction tests
console.log('\n--- Item Extraction ---');

test('extractItems finds items in Target email', () => {
  const text = getPlainTextPart(targetEmail);
  const decoded = decodeQuotedPrintable(text);
  const items = extractItems(decoded);
  expect(items.length).toBeGreaterThan(0);
});

test('extractItems parses quantity and price', () => {
  const text = '1x Test Item $10.00';
  const items = extractItems(text);
  expect(items.length).toBe(1);
  expect(items[0].quantity).toBe(1);
  expect(items[0].price).toBe(1000); // in cents
});

// Total extraction tests
console.log('\n--- Total Extraction ---');

test('extractTotal finds "Final total charged" pattern', () => {
  const total = extractTotal('Final total charged $40.58');
  expect(total).toBe(4058);
});

test('extractTotal finds "Total:" pattern', () => {
  const total = extractTotal('Total: $61.26');
  expect(total).toBe(6126);
});

test('extractTotal finds "ESTIMATED TOTAL" pattern', () => {
  const total = extractTotal('ESTIMATED TOTAL: $61.26');
  expect(total).toBe(6126);
});

test('extractTotal extracts from Target email', () => {
  const text = getPlainTextPart(targetEmail);
  const decoded = decodeQuotedPrintable(text);
  const total = extractTotal(decoded);
  expect(total).toBeGreaterThan(0);
});

// Address extraction tests
console.log('\n--- Address Extraction ---');

test('extractAddress finds address in content', () => {
  const address = extractAddress('Your receipt 1 Arkansas St #41, San Francisco, CA 94107, USA');
  expect(address).toContain('Arkansas');
  expect(address).toContain('San Francisco');
});

test('extractAddress extracts from Target email', () => {
  const text = getPlainTextPart(targetEmail);
  const decoded = decodeQuotedPrintable(text);
  const address = extractAddress(decoded);
  expect(address).toBeTruthy();
});

// Fees extraction tests
console.log('\n--- Fees Extraction ---');

test('extractFees finds subtotal', () => {
  const fees = extractFees('Subtotal $28.19');
  expect(fees.subtotal).toBe(2819);
});

test('extractFees finds tax', () => {
  const fees = extractFees('Tax $2.90');
  expect(fees.tax).toBe(290);
});

test('extractFees finds delivery fee', () => {
  const fees = extractFees('Delivery fee $0.00');
  expect(fees.deliveryFee).toBe(0);
});

test('extractFees finds service fee', () => {
  const fees = extractFees('Service fee $5.49');
  expect(fees.serviceFee).toBe(549);
});

test('extractFees finds tip', () => {
  const fees = extractFees('Dasher tip $4.00');
  expect(fees.tip).toBe(400);
});

test('extractFees extracts all fees from Target email', () => {
  const text = getPlainTextPart(targetEmail);
  const decoded = decodeQuotedPrintable(text);
  const fees = extractFees(decoded);
  expect(fees.subtotal).toBeGreaterThan(0);
});

// Full email parsing tests
console.log('\n--- Full Email Parsing ---');

test('parseDoordashEmail parses Target email correctly', () => {
  const order = parseDoordashEmail(targetEmail);
  expect(order).toBeTruthy();
  expect(order.restaurantName).toBe('Target');
  expect(order.emailType).toBe('final_receipt');
  expect(order.totalPrice).toBeGreaterThan(0);
});

test('parseDoordashEmail parses Bimi Poke email correctly', () => {
  const order = parseDoordashEmail(bimiPokeEmail);
  expect(order).toBeTruthy();
  expect(order.restaurantName).toBe('Bimi Poke');
  expect(order.emailType).toBe('confirmation');
});

test('parseDoordashEmail returns null for non-DoorDash emails', () => {
  const fakeEmail = 'From: someone@example.com\nSubject: Test\n\nBody';
  const order = parseDoordashEmail(fakeEmail);
  expect(order).toBeNull();
});

test('parseDoordashEmail includes delivery address', () => {
  const order = parseDoordashEmail(targetEmail);
  expect(order.deliveryAddress).toBeTruthy();
  expect(order.deliveryAddress.printableAddress).toBeTruthy();
});

// Multiple email parsing tests
console.log('\n--- Multiple Email Parsing ---');

test('parseMultipleEmails deduplicates by ID', () => {
  const orders = parseMultipleEmails([targetEmail, targetEmail]);
  expect(orders.length).toBe(1);
});

test('parseMultipleEmails parses both test emails', () => {
  const orders = parseMultipleEmails([targetEmail, bimiPokeEmail]);
  expect(orders.length).toBe(2);
});

test('parseMultipleEmails sorts by date descending', () => {
  const orders = parseMultipleEmails([targetEmail, bimiPokeEmail]);
  const date1 = new Date(orders[0].createdAt);
  const date2 = new Date(orders[1].createdAt);
  expect(date1.getTime()).toBeGreaterThan(date2.getTime());
});

// Summary
console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log();

if (failed > 0) {
  process.exit(1);
}
