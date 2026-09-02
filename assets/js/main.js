// Grit & Grains — shared site behaviour (nav, cart, WhatsApp checkout)

const WHATSAPP_NUMBER = "919217781654"; // +91 92177 81654

// UPI ID is only ever used to build the QR code / payment link — it is never
// displayed as text on the page.
const UPI_VPA = "6284602669@ptyes";
const UPI_PAYEE_NAME = "Grit and Grains";

const PRODUCTS = {
  "date-bites": {
    name: "Strength Date Bites",
    image: "assets/images/date-bites.png",
    sizes: { "250 g": 650, "500 g": 1200, "1 kg": 2125 },
  },
  "immunity-balls": {
    name: "Immunity Balls",
    image: "assets/images/immunity-balls.png",
    sizes: { "250 g": 450, "500 g": 750, "1 kg": 1444 },
  },
};

// Coupon codes live in the "Coupons" tab of the Google Sheet (same Apps
// Script deployment used for order sync) — edit/add/remove rows there, no
// code changes needed. Columns: Code, Type (percent/flat), Value, Label,
// FirstOrderOnly (TRUE/FALSE).
const COUPONS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbztwalpDHMcS5PNzro6YI8C94Hvu1P4KyYxP0mvxHKS05AJcjimjbPmlIBLvE1XRQ9D/exec";
let COUPONS = {};
let couponsLoaded = false;

async function loadCoupons() {
  try {
    const res = await fetch(COUPONS_ENDPOINT);
    COUPONS = await res.json();
  } catch (err) {
    console.error("Failed to load coupons:", err);
  } finally {
    couponsLoaded = true;
  }
}

const FREE_DELIVERY_THRESHOLD = 1000;
const DELIVERY_CHARGE = 100;

const CART_KEY = "gg-cart";
const COUPON_KEY = "gg-coupon";
const ORDER_PLACED_KEY = "gg-has-ordered";
const ADDRESS_KEY = "gg-address";
const ADDRESS_FIELDS = ["name", "phone", "email", "address", "locality", "landmark", "pincode", "city", "state"];

function hasOrderedBefore() {
  return localStorage.getItem(ORDER_PLACED_KEY) === "true";
}

function markOrderPlaced() {
  localStorage.setItem(ORDER_PLACED_KEY, "true");
}

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartCount();
  renderCartDrawer();
}

function addToCart(id, size, price) {
  const cart = getCart();
  const existing = cart.find((item) => item.id === id && item.size === size);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ id, size, price, qty: 1, name: PRODUCTS[id].name });
  }
  saveCart(cart);
  showToast(`Added ${PRODUCTS[id].name} (${size}) to cart`);
}

function changeQty(index, delta) {
  const cart = getCart();
  if (!cart[index]) return;
  cart[index].qty += delta;
  if (cart[index].qty <= 0) cart.splice(index, 1);
  saveCart(cart);
}

function removeFromCart(index) {
  const cart = getCart();
  cart.splice(index, 1);
  saveCart(cart);
}

function cartTotal(cart) {
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function getAppliedCoupon() {
  return localStorage.getItem(COUPON_KEY) || null;
}

function computeDiscount(subtotal, code) {
  const coupon = code && COUPONS[code];
  if (!coupon) return 0;
  const raw = coupon.type === "percent" ? Math.round((subtotal * coupon.value) / 100) : coupon.value;
  return Math.min(raw, subtotal);
}

function computeDeliveryCharge(amountAfterDiscount) {
  return amountAfterDiscount < FREE_DELIVERY_THRESHOLD ? DELIVERY_CHARGE : 0;
}

function cartGrandTotal(cart) {
  const subtotal = cartTotal(cart);
  const afterDiscount = Math.max(0, subtotal - computeDiscount(subtotal, getAppliedCoupon()));
  return afterDiscount + computeDeliveryCharge(afterDiscount);
}

function applyCoupon() {
  const input = document.getElementById("coupon-input");
  const code = input?.value.trim().toUpperCase();
  if (!code) {
    showToast("Enter a coupon code");
    return;
  }
  if (!couponsLoaded) {
    showToast("Still loading coupons — please try again in a moment");
    return;
  }
  const coupon = COUPONS[code];
  if (!coupon) {
    showToast("Invalid coupon code");
    return;
  }
  if (coupon.firstOrderOnly && hasOrderedBefore()) {
    showToast("This code is only valid for first-time orders");
    return;
  }
  if (coupon.startDate && new Date() < new Date(coupon.startDate)) {
    showToast("This coupon isn't active yet");
    return;
  }
  if (coupon.endDate) {
    const end = new Date(coupon.endDate);
    end.setHours(23, 59, 59, 999);
    if (new Date() > end) {
      showToast("This coupon has expired");
      return;
    }
  }
  localStorage.setItem(COUPON_KEY, code);
  if (input) input.value = "";
  renderCartDrawer();
  showToast(`Coupon applied — ${coupon.label}`);
}

function removeCoupon() {
  localStorage.removeItem(COUPON_KEY);
  renderCartDrawer();
  showToast("Coupon removed");
}

function updateCartCount() {
  const count = getCart().reduce((sum, item) => sum + item.qty, 0);
  document.querySelectorAll(".cart-count").forEach((el) => {
    el.textContent = count;
    el.style.display = count > 0 ? "flex" : "none";
  });
}

function renderCartDrawer() {
  const itemsEl = document.getElementById("cart-items");
  if (!itemsEl) return;

  const cart = getCart();
  if (cart.length === 0) {
    itemsEl.innerHTML = '<p class="cart-empty">Your cart is empty. Add some goodness from the Shop!</p>';
  } else {
    itemsEl.innerHTML = cart
      .map((item, i) => {
        const image = PRODUCTS[item.id]?.image;
        const thumb = image
          ? `<img src="${image}" alt="${item.name}">`
          : "🌰";
        return `
      <div class="cart-item">
        <div class="cart-item-thumb">${thumb}</div>
        <div class="cart-item-info">
          <strong>${item.name}</strong>
          <small>${item.size} · ₹${item.price} each</small>
          <div class="qty-controls">
            <button aria-label="Decrease quantity" onclick="changeQty(${i}, -1)">−</button>
            <span>${item.qty}</span>
            <button aria-label="Increase quantity" onclick="changeQty(${i}, 1)">+</button>
          </div>
          <button class="remove-item" onclick="removeFromCart(${i})">Remove</button>
        </div>
      </div>`;
      })
      .join("");
  }

  const subtotal = cartTotal(cart);
  const code = getAppliedCoupon();
  const discount = computeDiscount(subtotal, code);

  document.getElementById("cart-subtotal")?.replaceChildren(document.createTextNode(`₹${subtotal}`));

  const discountRow = document.getElementById("discount-row");
  if (discountRow) {
    if (code && discount > 0) {
      discountRow.style.display = "flex";
      const codeEl = document.getElementById("applied-coupon-code");
      if (codeEl) codeEl.textContent = code;
      document.getElementById("cart-discount")?.replaceChildren(document.createTextNode(`-₹${discount}`));
    } else {
      discountRow.style.display = "none";
    }
  }

  const afterDiscount = Math.max(0, subtotal - discount);
  const delivery = computeDeliveryCharge(afterDiscount);

  const deliveryRow = document.getElementById("delivery-row");
  if (deliveryRow) {
    if (delivery > 0) {
      deliveryRow.style.display = "flex";
      document.getElementById("cart-delivery")?.replaceChildren(document.createTextNode(`+₹${delivery}`));
    } else {
      deliveryRow.style.display = "none";
    }
  }

  document
    .getElementById("cart-total-amount")
    ?.replaceChildren(document.createTextNode(`₹${afterDiscount + delivery}`));
}

function getSavedAddress() {
  try {
    return JSON.parse(localStorage.getItem(ADDRESS_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function fillAddressForm() {
  const saved = getSavedAddress();
  ADDRESS_FIELDS.forEach((field) => {
    const el = document.getElementById(`addr-${field}`);
    if (el && saved[field]) el.value = saved[field];
  });
}

const REQUIRED_ADDRESS_FIELDS = ["name", "phone", "email", "address", "pincode", "city", "state"];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ADDRESS_VALIDATORS = {
  phone: { test: (v) => /^[6-9]\d{9}$/.test(v), message: "Please enter a valid 10-digit mobile number" },
  email: { test: (v) => EMAIL_REGEX.test(v), message: "Please enter a valid email address" },
  pincode: { test: (v) => /^\d{6}$/.test(v), message: "Please enter a valid 6-digit pincode" },
};

// Reads the delivery form, validates required fields, saves to localStorage,
// and returns the address — or null (with the first invalid field focused).
function getValidatedAddress() {
  const address = {};
  ADDRESS_FIELDS.forEach((field) => {
    address[field] = document.getElementById(`addr-${field}`)?.value.trim() || "";
  });

  for (const field of REQUIRED_ADDRESS_FIELDS) {
    if (!address[field]) {
      document.getElementById(`addr-${field}`)?.focus();
      showToast("Please fill in your delivery details first");
      return null;
    }
  }
  for (const field of Object.keys(ADDRESS_VALIDATORS)) {
    const { test, message } = ADDRESS_VALIDATORS[field];
    if (!test(address[field])) {
      document.getElementById(`addr-${field}`)?.focus();
      showToast(message);
      return null;
    }
  }

  localStorage.setItem(ADDRESS_KEY, JSON.stringify(address));
  return address;
}

function formatAddressBlock(address) {
  const line2 = [address.locality, address.landmark && `Landmark: ${address.landmark}`].filter(Boolean).join(", ");
  const line3 = `${address.city}, ${address.state} - ${address.pincode}`;
  return [
    "📍 Deliver to:",
    `${address.name} · ${address.phone} · ${address.email}`,
    address.address,
    line2,
    line3,
  ]
    .filter(Boolean)
    .join("\n");
}

// Hidden testing aid — only visible with ?test=1 in the URL (see initTestMode).
// Lets you exercise the full checkout/order-save flow without WhatsApp or a
// real UPI payment. Never shown to real customers.
function submitTestOrder() {
  const cart = getCart();
  if (cart.length === 0) {
    showToast("Your cart is empty");
    return;
  }
  const address = getValidatedAddress();
  if (!address) return;

  const orderId = window.GritAuth?.generateOrderId() || "";
  const subtotal = cartTotal(cart);
  const couponCode = getAppliedCoupon();

  window.GritAuth?.saveOrder({
    orderId,
    items: cart,
    subtotal,
    discount: computeDiscount(subtotal, couponCode),
    couponCode: couponCode || null,
    total: cartGrandTotal(cart),
    address,
    paymentMethod: "test",
    status: "test",
  });
  markOrderPlaced();
  saveCart([]);
  localStorage.removeItem(COUPON_KEY);
  showToast(`Test order submitted — Order ID: ${orderId}`, 6000);
}

function initTestMode() {
  const isTest = new URLSearchParams(location.search).get("test") === "1";
  const btn = document.getElementById("submit-test");
  if (btn) btn.style.display = isTest ? "block" : "none";
}

function formatTotalsBlock(cart) {
  const subtotal = cartTotal(cart);
  const code = getAppliedCoupon();
  const discount = computeDiscount(subtotal, code);
  const afterDiscount = Math.max(0, subtotal - discount);
  const delivery = computeDeliveryCharge(afterDiscount);

  if (!discount && !delivery) {
    return `Total: ₹${subtotal}`;
  }

  const lines = [`Subtotal: ₹${subtotal}`];
  if (discount > 0 && code) lines.push(`Coupon (${code}): -₹${discount}`);
  if (delivery > 0) lines.push(`Delivery Charge: +₹${delivery}`);
  lines.push(`Total: ₹${afterDiscount + delivery}`);
  return lines.join("\n");
}

let _pendingUpiOrder = null;

function payViaUPI() {
  const cart = getCart();
  if (cart.length === 0) {
    showToast("Your cart is empty");
    return;
  }
  const address = getValidatedAddress();
  if (!address) return;

  const subtotal = cartTotal(cart);
  const couponCode = getAppliedCoupon();
  const total = cartGrandTotal(cart);
  const orderId = window.GritAuth?.generateOrderId() || "";
  const orderNote = cart.map((item) => `${item.name} (${item.size}) x${item.qty}`).join(", ");
  const upiUrl = `upi://pay?pa=${encodeURIComponent(UPI_VPA)}&pn=${encodeURIComponent(UPI_PAYEE_NAME)}&am=${total}&cu=INR&tn=${encodeURIComponent(orderId ? `${orderNote} | ${orderId}` : orderNote)}`;

  _pendingUpiOrder = {
    orderId,
    total,
    orderNote,
    address,
    items: cart,
    subtotal,
    discount: computeDiscount(subtotal, couponCode),
    couponCode: couponCode || null,
  };
  openUpiModal(total, upiUrl);
}

function openUpiModal(total, upiUrl) {
  const amountEl = document.getElementById("upi-amount");
  if (amountEl) amountEl.textContent = `₹${total}`;

  const qrHolder = document.getElementById("upi-qrcode");
  if (qrHolder) {
    qrHolder.innerHTML = "";
    // eslint-disable-next-line no-undef
    new QRCode(qrHolder, { text: upiUrl, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
  }

  document.getElementById("upi-modal")?.classList.add("open");
  document.getElementById("upi-overlay")?.classList.add("open");
}

function closeUpiModal() {
  document.getElementById("upi-modal")?.classList.remove("open");
  document.getElementById("upi-overlay")?.classList.remove("open");
}

function confirmUpiPaid() {
  if (!_pendingUpiOrder) return;
  const { orderId, total, orderNote, address, items, subtotal, discount, couponCode } = _pendingUpiOrder;
  let message = `Hi Grit & Grains! I've just paid via UPI for:\n\n${orderNote}\n\n${formatTotalsBlock(items)}\n\n${formatAddressBlock(address)}`;
  if (orderId) message += `\n\nOrder ID: ${orderId}`;
  message += `\n\nPlease confirm and share the delivery timeline.`;
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, "_blank");

  window.GritAuth?.saveOrder({
    orderId,
    items,
    subtotal,
    discount,
    couponCode,
    total,
    address,
    paymentMethod: "upi",
    status: "new",
  });

  markOrderPlaced();
  closeUpiModal();
  saveCart([]);
  localStorage.removeItem(COUPON_KEY);
  showToast("Thanks! We've been notified on WhatsApp.");
}

function showToast(text, duration = 2400) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => toast.classList.remove("show"), duration);
}

/* ---------- Nav toggle ---------- */
function initNav() {
  const toggle = document.getElementById("nav-toggle");
  const links = document.getElementById("nav-links");
  toggle?.addEventListener("click", () => links.classList.toggle("open"));
}

/* ---------- Reveal on scroll ---------- */
function initReveal() {
  const items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window) || items.length === 0) {
    items.forEach((el) => el.classList.add("in-view"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  items.forEach((el) => observer.observe(el));
}

/* ---------- Footer year ---------- */
function initFooterYear() {
  document.querySelectorAll(".footer-year").forEach((el) => {
    el.textContent = new Date().getFullYear();
  });
}

/* ---------- Product size selector (menu page) ---------- */
function initProductCards() {
  document.querySelectorAll(".product-card").forEach((card) => {
    const id = card.dataset.productId;
    const options = card.querySelectorAll(".size-option");
    const priceDisplay = card.querySelector(".price-display");
    const addBtn = card.querySelector(".add-to-cart-btn");
    let selectedSize = options[0]?.dataset.size;
    let selectedPrice = Number(options[0]?.dataset.price);

    options.forEach((opt) => {
      opt.addEventListener("click", () => {
        options.forEach((o) => o.classList.remove("selected"));
        opt.classList.add("selected");
        selectedSize = opt.dataset.size;
        selectedPrice = Number(opt.dataset.price);
        if (priceDisplay) priceDisplay.textContent = `₹${selectedPrice}`;
      });
    });

    addBtn?.addEventListener("click", () => addToCart(id, selectedSize, selectedPrice));
  });
}

/* ---------- Contact form (mailto + WhatsApp fallback, no backend) ---------- */
function initContactForm() {
  const form = document.getElementById("contact-form");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const phone = form.phone.value.trim();
    const msg = form.message.value.trim();

    if (!name || !email || !phone || !msg) {
      showToast("Please fill in all fields");
      return;
    }
    if (!EMAIL_REGEX.test(email)) {
      form.email.focus();
      showToast("Please enter a valid email address");
      return;
    }
    if (!/^[6-9]\d{9}$/.test(phone)) {
      form.phone.focus();
      showToast("Please enter a valid 10-digit mobile number");
      return;
    }

    const text = `Hi Grit & Grains, I'm ${name} (${email}, ${phone}).\n\n${msg}`;
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`, "_blank");
    showToast("Opening WhatsApp to send your message…");
    form.reset();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initNav();
  initReveal();
  initFooterYear();
  initProductCards();
  initContactForm();
  updateCartCount();
  renderCartDrawer();
  fillAddressForm();
  initTestMode();
  loadCoupons().then(() => renderCartDrawer());

  document.getElementById("checkout-upi")?.addEventListener("click", payViaUPI);
  document.getElementById("submit-test")?.addEventListener("click", submitTestOrder);
  document.getElementById("upi-close")?.addEventListener("click", closeUpiModal);
  document.getElementById("upi-overlay")?.addEventListener("click", closeUpiModal);
  document.getElementById("upi-confirm-paid")?.addEventListener("click", confirmUpiPaid);
  document.getElementById("coupon-apply")?.addEventListener("click", applyCoupon);
  document.getElementById("coupon-remove")?.addEventListener("click", removeCoupon);
});
