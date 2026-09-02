// Grit & Grains — Firebase phone-OTP sign-in with an optional password for
// faster return visits + order storage.
//
// Firebase Auth has no native "phone + password" provider, so this uses a
// well-known pattern: verify the real phone number via SMS OTP once, then
// link a password to that same account via Firebase's email/password
// provider using a deterministic, synthetic "email" derived from the phone
// number (e.g. "9876543210@phone.gritandgrains.in"). The customer only ever
// sees/types their phone number and password — the synthetic email is an
// internal implementation detail, never shown or emailed anywhere.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithEmailAndPassword,
  signInAnonymously,
  linkWithCredential,
  updatePassword,
  EmailAuthProvider,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCLCFmlQBWHv4wHeNTJil6gIjM41frDrhY",
  authDomain: "gritandgrains.firebaseapp.com",
  projectId: "gritandgrains",
  storageBucket: "gritandgrains.firebasestorage.app",
  messagingSenderId: "142475222051",
  appId: "1:142475222051:web:88c5715406437f8750e596",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function phoneToPseudoEmail(phone) {
  return `${phone}@phone.gritandgrains.in`;
}

// Guests get a silent, invisible anonymous session so their orders can still
// be written to Firestore (the security rules require a signed-in uid) —
// no OTP, no UI, nothing the customer ever sees.
async function ensureAuthSession() {
  if (auth.currentUser) return auth.currentUser;
  try {
    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch (err) {
    console.error("Anonymous sign-in failed:", err);
    return null;
  }
}

let recaptchaVerifier = null;
let confirmationResult = null;
let pendingAction = null;
let currentProfile = null;

function getRecaptcha() {
  if (!recaptchaVerifier) {
    recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
  }
  return recaptchaVerifier;
}

function showStep(step) {
  ["signin", "phone", "otp", "profile", "setpassword"].forEach((s) => {
    const el = document.getElementById(`auth-step-${s}`);
    if (el) el.style.display = s === step ? "block" : "none";
  });
}

function openAuthModal(step = "signin") {
  document.getElementById("auth-modal")?.classList.add("open");
  document.getElementById("auth-overlay")?.classList.add("open");
  showStep(step);
}

function closeAuthModal() {
  document.getElementById("auth-modal")?.classList.remove("open");
  document.getElementById("auth-overlay")?.classList.remove("open");
}

/* ---------- Sign in with phone + password (returning users) ---------- */
async function handleSignIn() {
  const phone = document.getElementById("auth-signin-phone")?.value.trim();
  const password = document.getElementById("auth-signin-password")?.value;

  if (!/^[6-9]\d{9}$/.test(phone || "")) {
    window.showToast?.("Please enter a valid 10-digit mobile number");
    return;
  }
  if (!password) {
    window.showToast?.("Please enter your password");
    return;
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, phoneToPseudoEmail(phone), password);
    const snap = await getDoc(doc(db, "users", cred.user.uid));
    currentProfile = snap.exists() ? snap.data() : { phone };
    finishSignIn();
  } catch (err) {
    console.error("signIn failed:", err);
    if (["auth/user-not-found", "auth/invalid-credential", "auth/wrong-password"].includes(err.code)) {
      window.showToast?.("No password set for this number yet — verify by OTP", 5000);
      const otpPhone = document.getElementById("auth-phone");
      if (otpPhone) otpPhone.value = phone;
      showStep("phone");
    } else if (err.code === "auth/too-many-requests") {
      window.showToast?.("Too many attempts — please try again later.", 5000);
    } else {
      window.showToast?.(`Sign in failed: ${err.code || err.message || "unknown error"}`, 5000);
    }
  }
}

/* ---------- Verify phone via OTP (new users, or forgot password) ---------- */
async function sendOtp() {
  const phoneInput = document.getElementById("auth-phone");
  const phone = phoneInput?.value.trim();
  if (!/^[6-9]\d{9}$/.test(phone || "")) {
    window.showToast?.("Please enter a valid 10-digit mobile number");
    return;
  }
  try {
    confirmationResult = await signInWithPhoneNumber(auth, "+91" + phone, getRecaptcha());
    const display = document.getElementById("auth-otp-phone-display");
    if (display) display.textContent = "+91 " + phone;
    showStep("otp");
    window.showToast?.("OTP sent");
  } catch (err) {
    console.error("sendOtp failed:", err);
    window.showToast?.(`OTP failed: ${err.code || err.message || "unknown error"}`, 8000);
  }
}

async function verifyOtp() {
  const otp = document.getElementById("auth-otp")?.value.trim();
  if (!confirmationResult || !/^\d{6}$/.test(otp || "")) {
    window.showToast?.("Please enter the 6-digit OTP");
    return;
  }
  try {
    const cred = await confirmationResult.confirm(otp);
    const user = cred.user;
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      currentProfile = snap.data();
    } else {
      currentProfile = null;
    }
    showStep(currentProfile ? "setpassword" : "profile");
  } catch (err) {
    console.error("verifyOtp failed:", err);
    window.showToast?.(`Verification failed: ${err.code || err.message || "unknown error"}`, 8000);
  }
}

/* ---------- First-time profile (name + email, contact details only) ---------- */
async function saveProfile() {
  const name = document.getElementById("auth-name")?.value.trim();
  const email = document.getElementById("auth-email")?.value.trim();
  if (!name) {
    window.showToast?.("Please enter your name");
    return;
  }
  if (!EMAIL_REGEX.test(email || "")) {
    window.showToast?.("Please enter a valid email address");
    return;
  }
  const user = auth.currentUser;
  if (!user) return;
  const profile = { name, email, phone: user.phoneNumber, hasPassword: false, createdAt: serverTimestamp() };
  await setDoc(doc(db, "users", user.uid), profile, { merge: true });
  currentProfile = profile;
  showStep("setpassword");
}

/* ---------- Set / update password, linked to the phone-verified account ---------- */
async function savePassword() {
  const password = document.getElementById("auth-setpassword-password")?.value;
  const confirmPassword = document.getElementById("auth-setpassword-confirm")?.value;
  if (!password || password.length < 6) {
    window.showToast?.("Password must be at least 6 characters");
    return;
  }
  if (password !== confirmPassword) {
    window.showToast?.("Passwords do not match");
    return;
  }
  const user = auth.currentUser;
  if (!user || !user.phoneNumber) return;
  const bareDigits = user.phoneNumber.replace(/^\+91/, "");
  try {
    try {
      await linkWithCredential(user, EmailAuthProvider.credential(phoneToPseudoEmail(bareDigits), password));
    } catch (err) {
      if (err.code === "auth/provider-already-linked") {
        await updatePassword(user, password);
      } else {
        throw err;
      }
    }
    await setDoc(doc(db, "users", user.uid), { hasPassword: true }, { merge: true });
    if (currentProfile) currentProfile.hasPassword = true;
    finishSignIn();
  } catch (err) {
    console.error("savePassword failed:", err);
    window.showToast?.(`Couldn't save password: ${err.code || err.message || "unknown error"}`, 6000);
  }
}

function skipSetPassword() {
  finishSignIn();
}

function finishSignIn() {
  closeAuthModal();
  window.showToast?.(`Welcome, ${(currentProfile?.name || "back").split(" ")[0]}!`);
  updateAccountUI();
  const action = pendingAction;
  pendingAction = null;
  if (action) action();
}

function updateAccountUI() {
  const signedIn = !!(auth.currentUser && currentProfile);
  document.querySelectorAll(".account-label").forEach((el) => {
    el.textContent = signedIn ? `👤 ${(currentProfile.name || "Account").split(" ")[0]}` : "👤 Sign In";
  });
}

function openAccountModal() {
  const nameEl = document.getElementById("account-modal-name");
  const phoneEl = document.getElementById("account-modal-phone");
  if (nameEl) nameEl.textContent = currentProfile?.name || "Account";
  if (phoneEl) phoneEl.textContent = auth.currentUser?.phoneNumber || currentProfile?.phone || "";
  document.getElementById("account-modal")?.classList.add("open");
  document.getElementById("account-overlay")?.classList.add("open");
}

function closeAccountModal() {
  document.getElementById("account-modal")?.classList.remove("open");
  document.getElementById("account-overlay")?.classList.remove("open");
}

async function handleSignOut() {
  await signOut(auth);
  currentProfile = null;
  updateAccountUI();
  closeAccountModal();
  window.showToast?.("Signed out");
}

function handleAccountClick() {
  if (auth.currentUser && !auth.currentUser.isAnonymous) {
    openAccountModal();
  } else {
    pendingAction = null;
    openAuthModal("signin");
  }
}

function requireSignIn(callback) {
  if (auth.currentUser && currentProfile) {
    callback();
    return;
  }
  pendingAction = callback;
  openAuthModal("signin");
}

function generateOrderId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `GG-${ts}-${rand}`;
}

async function saveOrder(order) {
  const user = await ensureAuthSession();
  if (!user) return null;
  const orderId = order.orderId || generateOrderId();
  try {
    await setDoc(doc(db, "orders", orderId), {
      ...order,
      orderId,
      userId: user.uid,
      guest: user.isAnonymous,
      customerName: currentProfile?.name || order.address?.name || "",
      customerPhone: (!user.isAnonymous && user.phoneNumber) || order.address?.phone || "",
      customerEmail: currentProfile?.email || order.address?.email || "",
      createdAt: serverTimestamp(),
    });
    return orderId;
  } catch (err) {
    console.error("Order save failed", err);
    return null;
  }
}

onAuthStateChanged(auth, async (user) => {
  if (user && !user.isAnonymous) {
    const snap = await getDoc(doc(db, "users", user.uid));
    currentProfile = snap.exists() ? snap.data() : { phone: user.phoneNumber };
  } else {
    currentProfile = null;
    if (!user) ensureAuthSession();
  }
  updateAccountUI();
});

window.GritAuth = {
  getCurrentUser: () =>
    auth.currentUser && currentProfile ? { ...currentProfile, uid: auth.currentUser.uid } : null,
  requireSignIn,
  saveOrder,
  generateOrderId,
};

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("account-btn")?.addEventListener("click", handleAccountClick);
  document.getElementById("auth-close")?.addEventListener("click", closeAuthModal);
  document.getElementById("auth-overlay")?.addEventListener("click", closeAuthModal);
  document.getElementById("account-close")?.addEventListener("click", closeAccountModal);
  document.getElementById("account-overlay")?.addEventListener("click", closeAccountModal);
  document.getElementById("account-signout")?.addEventListener("click", handleSignOut);

  document.getElementById("auth-signin-submit")?.addEventListener("click", handleSignIn);
  document.getElementById("auth-goto-phone")?.addEventListener("click", () => showStep("phone"));
  document.getElementById("auth-goto-signin")?.addEventListener("click", () => showStep("signin"));
  document.getElementById("auth-send-otp")?.addEventListener("click", sendOtp);
  document.getElementById("auth-verify-otp")?.addEventListener("click", verifyOtp);
  document.getElementById("auth-resend-otp")?.addEventListener("click", () => {
    confirmationResult = null;
    showStep("phone");
  });
  document.getElementById("auth-save-profile")?.addEventListener("click", saveProfile);
  document.getElementById("auth-save-password")?.addEventListener("click", savePassword);
  document.getElementById("auth-skip-password")?.addEventListener("click", skipSetPassword);
});
