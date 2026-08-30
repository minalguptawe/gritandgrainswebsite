// Grit & Grains — Firebase phone-OTP sign-in + order storage
// Uses the Firebase modular SDK v12 straight from Google's CDN (no bundler needed).

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  addDoc,
  collection,
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
  ["phone", "otp", "profile"].forEach((s) => {
    const el = document.getElementById(`auth-step-${s}`);
    if (el) el.style.display = s === step ? "block" : "none";
  });
}

function openAuthModal() {
  document.getElementById("auth-modal")?.classList.add("open");
  document.getElementById("auth-overlay")?.classList.add("open");
  showStep("phone");
}

function closeAuthModal() {
  document.getElementById("auth-modal")?.classList.remove("open");
  document.getElementById("auth-overlay")?.classList.remove("open");
}

async function sendOtp() {
  const phoneInput = document.getElementById("auth-phone");
  const phone = phoneInput?.value.trim();
  if (!/^[6-9]\d{9}$/.test(phone)) {
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
    console.error(err);
    window.showToast?.("Couldn't send OTP — please try again");
  }
}

async function verifyOtp() {
  const otp = document.getElementById("auth-otp")?.value.trim();
  if (!confirmationResult || !/^\d{6}$/.test(otp)) {
    window.showToast?.("Please enter the 6-digit OTP");
    return;
  }
  try {
    const cred = await confirmationResult.confirm(otp);
    const user = cred.user;
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      currentProfile = snap.data();
      finishSignIn();
    } else {
      showStep("profile");
    }
  } catch (err) {
    console.error(err);
    window.showToast?.("Incorrect OTP — please try again");
  }
}

async function saveProfile() {
  const name = document.getElementById("auth-name")?.value.trim();
  const email = document.getElementById("auth-email")?.value.trim();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
  if (!name) {
    window.showToast?.("Please enter your name");
    return;
  }
  if (!emailOk) {
    window.showToast?.("Please enter a valid email address");
    return;
  }
  const user = auth.currentUser;
  if (!user) return;
  const profile = { name, email, phone: user.phoneNumber, createdAt: serverTimestamp() };
  await setDoc(doc(db, "users", user.uid), profile, { merge: true });
  currentProfile = profile;
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
    el.textContent = signedIn ? `👤 ${currentProfile.name.split(" ")[0]}` : "👤 Sign In";
  });
}

async function handleAccountClick() {
  if (auth.currentUser) {
    await signOut(auth);
    currentProfile = null;
    updateAccountUI();
    window.showToast?.("Signed out");
  } else {
    pendingAction = null;
    openAuthModal();
  }
}

function requireSignIn(callback) {
  if (auth.currentUser && currentProfile) {
    callback();
    return;
  }
  pendingAction = callback;
  openAuthModal();
}

async function saveOrder(order) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await addDoc(collection(db, "orders"), {
      ...order,
      userId: user.uid,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Order save failed", err);
  }
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    const snap = await getDoc(doc(db, "users", user.uid));
    currentProfile = snap.exists() ? snap.data() : null;
  } else {
    currentProfile = null;
  }
  updateAccountUI();
});

window.GritAuth = {
  getCurrentUser: () =>
    auth.currentUser && currentProfile ? { ...currentProfile, uid: auth.currentUser.uid } : null,
  requireSignIn,
  saveOrder,
};

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("account-btn")?.addEventListener("click", handleAccountClick);
  document.getElementById("auth-close")?.addEventListener("click", closeAuthModal);
  document.getElementById("auth-overlay")?.addEventListener("click", closeAuthModal);
  document.getElementById("auth-send-otp")?.addEventListener("click", sendOtp);
  document.getElementById("auth-verify-otp")?.addEventListener("click", verifyOtp);
  document.getElementById("auth-resend-otp")?.addEventListener("click", () => {
    confirmationResult = null;
    showStep("phone");
  });
  document.getElementById("auth-save-profile")?.addEventListener("click", saveProfile);
});
