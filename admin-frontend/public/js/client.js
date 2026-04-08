// client.js - To'liq va To'g'rilangan versiya
import { CATEGORY_DATA, ORDER_STATUS } from "./shared.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import {
  getDatabase,
  ref,
  get,
  set,
  update,
  push,
  onValue,
  runTransaction,
  off,
  onChildAdded
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

import { t, getLang, setLang, applyLang, onLangChange } from "./i18n.js";

let cart = {};
const firebaseConfig = {
  databaseURL: "https://restoran-30d51-default-rtdb.firebaseio.com"
};

const app = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApps()[0];

const db = getDatabase(app);

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function getOrderStatusKey(order) {
  const raw = normalizeStatus(order?.status || order?.statusKey);

  const map = {
    yangi: "yangi",
    new: "yangi",
    tasdiqlandi: "tasdiqlandi",
    approved: "tasdiqlandi",
    tayyorlanmoqda: "tayyorlanmoqda",
    cooking: "tayyorlanmoqda",
    tayyor: "tayyor",
    ready: "tayyor",
    yopildi: "yopildi",
    closed: "yopildi",
    "bekor qilindi": "bekor qilindi",
    cancelled: "bekor qilindi",
    queue: "queue"
  };

  return map[raw] || raw;
}

checkDiscountFromURL();
let clientId = localStorage.getItem("clientId");

if (!clientId) {
  clientId = "CL" + Math.random().toString(36).substring(2, 9);
  localStorage.setItem("clientId", clientId);
}

function checkDiscountFromURL() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("discount");

  if (!code) return;

  get(ref(db, "discounts/" + code)).then(snap => {
    if (!snap.exists()) return;

    const data = snap.val();

    if (data.used) {
      alert(t("discount_used"));
      return;
    }

    localStorage.setItem("discountPercent", data.percent);
    localStorage.setItem("discountCode", code);

    alert(`🎉 ${data.percent}% ${t("discount_activated")}`);
  });
}
const SUBMITTED_ORDER_FLAG = "client_has_submitted_order";

/* =========================
   GLOBAL STATE
========================= */
let allMenu = {};
let stopListData = {};
let tableNumber = null;
let confirmedTableNumber = null;
let currentOrderId = null;
let cartItems, cartTotal, cartCount, cartModal, tablesContainer;
let TOP_FOODS = [];
let filterCategory, filterSubcategory, filterTypeSelect, searchInput;
let currentPaymentTotal = 0;
let clientMenu;
let filterCategoryValue = "all";
let filterSubcategoryValue = "all";
let filterType = "all";
let searchQuery = "";
let clientTimerInterval = null;
let baseReadyAt = null;
let receiptShownForOrder = null;
let stopActiveOrderListener = null;
let allowReceiptOpen = false;
let currentBaseCookTime = 30;
let chatFab, headerReadyBox, headerReadyTime, headerReadyCountdown;
let clientChatModal, clientChatInfo, clientChatMessages, clientChatInput, clientChatSendBtn;
let activeOrderData = null;
let hasSubmittedOrder = false;
const socket = typeof io !== "undefined" ? io() : null;
const tableInput = document.getElementById("tableInput");
const orderStatus = document.getElementById("orderStatus");
const orderStatusBox = document.getElementById("orderStatusBox");
let RESTAURANT_SETTINGS = {
  fastOrderActive: true,
  fastFee: 5,
  fastOrderMinusMinutes: 10,
  normalOrderBaseTime: 30,
  fastOrderMinAmount: 80000
};

onValue(ref(db, "settings"), snap => {
  if (snap.exists()) {
    RESTAURANT_SETTINGS = { ...RESTAURANT_SETTINGS, ...snap.val() };
    updatePaymentSummary();
  }
});
if (localStorage.getItem("role") !== "client") {
  location.href = "login.html";
}

const FIREBASE_API = "https://restoran-30d51-default-rtdb.firebaseio.com";

/* =========================
   INIT DOM
========================= */
document.addEventListener("DOMContentLoaded", () => {
  clientMenu = document.getElementById("clientMenu");
  filterCategory = document.getElementById("filterCategory");
  filterSubcategory = document.getElementById("filterSubcategory");
  filterTypeSelect = document.getElementById("filterType");
  searchInput = document.getElementById("menuSearch");
  tableNumber = localStorage.getItem("table");
  cartItems = document.getElementById("cartItems");
  cartTotal = document.getElementById("cartTotal");
  cartCount = document.getElementById("cartCount");
  cartModal = document.getElementById("cartModal");
  tablesContainer = document.getElementById("tablesContainer");
  chatFab = document.getElementById("chatFab");
  clientChatModal = document.getElementById("clientChatModal");
  clientChatInfo = document.getElementById("clientChatInfo");
  clientChatMessages = document.getElementById("clientChatMessages");
  clientChatInput = document.getElementById("clientChatInput");
  clientChatSendBtn = document.getElementById("clientChatSendBtn");
  headerReadyBox = document.getElementById("headerReadyBox");
  headerReadyTime = document.getElementById("headerReadyTime");
  headerReadyCountdown = document.getElementById("headerReadyCountdown");

  const savedCart = localStorage.getItem("clientCart");
  const savedActiveOrderId = localStorage.getItem("activeOrderId");

  hasSubmittedOrder = sessionStorage.getItem(SUBMITTED_ORDER_FLAG) === "1";

  if (savedCart && savedActiveOrderId) {
    try { cart = JSON.parse(savedCart) || {}; } catch { cart = {}; }
  } else {
    cart = {};
    localStorage.removeItem("clientCart");
    localStorage.removeItem("activeOrderId");
    localStorage.removeItem("lastOrderStatus");
  }

  const langSelect = document.getElementById("langSelect");
  if (langSelect) {
    langSelect.value = getLang();
    langSelect.addEventListener("change", e => { setLang(e.target.value); });
  }

  const tableCheckBtn = document.getElementById("tableCheckBtn");
  const tableInputEl = document.getElementById("tableInput");

  const hasActiveOrderOnLoad = !!localStorage.getItem("activeOrderId");

  if (hasActiveOrderOnLoad) {
    confirmedTableNumber = localStorage.getItem("confirmedTable") || localStorage.getItem("table") || null;
    if (tableInputEl && confirmedTableNumber) tableInputEl.value = confirmedTableNumber;
  } else {
    confirmedTableNumber = null;
    tableNumber = null;
    localStorage.removeItem("table");
    localStorage.removeItem("confirmedTable");
    if (tableInputEl) tableInputEl.value = "";
  }

  if (tableCheckBtn) {
    tableCheckBtn.onclick = async (e) => {
      e.preventDefault();
      await checkTable();
    };
  }

  tableInputEl?.addEventListener("keydown", async e => {
    if (e.key === "Enter") {
      e.preventDefault();
      await checkTable();
    }
  });

  tableInputEl?.addEventListener("input", () => {
    setTableStatusMessage("", "");

    const statusBox = document.getElementById("orderStatusBox");
    if (statusBox) statusBox.style.display = "none";
  });

  const orderBox = document.getElementById("orderStatusBox");

  if (receiptBox) receiptBox.style.display = "none";
  if (orderBox) orderBox.style.display = "none";

  if (receiptBox) {
    receiptBox.addEventListener("click", function (e) {
      if (e.target.id === "receiptBox") closeReceipt();
    });
  }

  allowReceiptOpen = false;

  applyLang();
  renderCategoryFilter();
  renderSubcategoryFilter();
  bindFilters();
  subscribeMenuRealtime();

  onValue(ref(db, "stopList"), snap => {
    stopListData = snap.val() || {};
    renderMenu();
  });

  onValue(ref(db, "stopList"), snap => {
    stopListData = snap.val() || {};
    safeRenderMenu();
  });

  updateCart();
  renderMenu();
  applyClientPageTranslations();
  clearHeaderReadyInfo();

  restoreSubmittedOrderState().then(() => {
    listenActiveOrder();
    initClientChat();
  });

  get(ref(db, "settings/maxTable")).then(snap => {
    if (!snap.exists()) return;
    const input = document.getElementById("tableInput");
    if (input) input.max = snap.val();
  });

  const initialReceiptBox = document.getElementById("receiptBox");
  const initialReceiptContent = document.getElementById("receiptContent");

  if (initialReceiptBox) {
    initialReceiptBox.style.display = "none";
  }
  if (initialReceiptContent) {
    initialReceiptContent.innerHTML = "";
  }
});

/* =========================
   UI XIZMAT FUNKSIYALARI
========================= */
function resetClientSession() {
  stopClientChatRealtime();
  cart = {};
  currentOrderId = null;
  hasSubmittedOrder = false;
  receiptShownForOrder = null;

  localStorage.removeItem("lastOrderStatus");
  sessionStorage.removeItem("client_has_submitted_order");
  localStorage.removeItem("clientCart");
  localStorage.removeItem("activeOrderId");
  localStorage.removeItem("confirmedTable");
  localStorage.removeItem("table");
  localStorage.removeItem("receiptShown");

  tableNumber = null;
  confirmedTableNumber = null;

  const tableInputEl = document.getElementById("tableInput");
  if (tableInputEl) tableInputEl.value = "";

  closeClientChat(true);
  closeReceipt();

  const statusBox = document.getElementById("orderStatusBox");
  if (statusBox) statusBox.style.display = "none";

  stopClientCountdown();
  clearHeaderReadyInfo();
  updateCart();
  renderMenu();
}

function stopClientCountdown() {
  if (clientTimerInterval) {
    clearInterval(clientTimerInterval);
    clientTimerInterval = null;
  }
  const timerEl = document.getElementById("clientTimer");
  if (timerEl) {
    timerEl.innerText = "";
    timerEl.style.color = "";
  }
  if (headerReadyCountdown) {
    headerReadyCountdown.innerText = "";
    headerReadyCountdown.style.color = "#f59e0b";
  }
}

function showHeaderReadyBox() {
  if (headerReadyBox) headerReadyBox.style.display = "block";
}

function hideHeaderReadyBox() {
  if (headerReadyBox) headerReadyBox.style.display = "none";
}

function clearHeaderReadyInfo() {
  hideHeaderReadyBox();
  if (headerReadyTime) headerReadyTime.innerText = "";
  if (headerReadyCountdown) {
    headerReadyCountdown.innerText = "";
    headerReadyCountdown.style.color = "#f59e0b";
  }
}

function updateHeaderReadyInfo(readyAt) {
  if (!headerReadyTime) return;
  showHeaderReadyBox();
  const dt = new Date(Number(readyAt || Date.now()));
  headerReadyTime.innerText = `${t("ready_at_label")}: ${dt.toLocaleTimeString()}`;
}

function setPreviewReadyInfo(readyAt) {
  updateHeaderReadyInfo(readyAt);
  const readyEl = document.getElementById("clientReadyTime");
  const countdownEl = document.getElementById("clientTimer");

  if (readyEl) {
    const dt = new Date(readyAt);
    readyEl.innerText = `🍽 ${t("ready_time")}: ${dt.toLocaleTimeString()}`;
  }
  if (countdownEl) {
    countdownEl.innerText = `⏳ ${t("waiting_chef_start") || "Oshpaz boshlashi kutilmoqda"}`;
    countdownEl.style.color = "#64748b";
  }
  if (headerReadyCountdown) {
    headerReadyCountdown.innerText = t("waiting_chef_start") || "Oshpaz boshlashi kutilmoqda";
    headerReadyCountdown.style.color = "#64748b";
  }
}

/* =========================
   CATEGORY FILTERS & MENU
========================= */
function renderCategoryFilter() {
  if (!filterCategory) return;
  filterCategory.innerHTML = `<option value="all">${t("all_categories")}</option>`;
  CATEGORY_DATA.categories.forEach(cat => {
    filterCategory.innerHTML += `<option value="${cat.id}">${t(cat.nameKey)}</option>`;
  });
}

function renderSubcategoryFilter() {
  const el = document.getElementById("filterSubcategory");
  if (!el) return;
  el.innerHTML = `<option value="all">${t("all_subcategories")}</option>`;
  if (filterCategoryValue === "all") return;
  const cat = CATEGORY_DATA.categories.find(c => c.id === filterCategoryValue);
  if (!cat) return;
  cat.sub.forEach(subKey => {
    el.innerHTML += `<option value="${subKey}">${t(subKey)}</option>`;
  });
}

/* =========================
   RENDER MENU (YANGILANGAN)
========================= */
function renderMenu() {
  if (!clientMenu) return;

  const lang = getLang();

  let items = Object.entries(allMenu || {}).map(([id, i]) => ({
    id,
    ...i
  }));

  items = items.filter(i => stopListData[i.id] !== true);

  if (searchQuery) {
    items = items.filter(i => {
      const name = i.name?.[lang] || i.name?.uz || i.name?.ru || i.name?.en || "";
      return name.toLowerCase().includes(searchQuery);
    });
  }

  if (filterCategoryValue !== "all") {
    items = items.filter(i => i.category === filterCategoryValue);
  }

  if (filterSubcategoryValue !== "all") {
    items = items.filter(i => i.subcategory === filterSubcategoryValue);
  }

  if (filterType === "new") items = items.filter(i => isNewFood(i));
  if (filterType === "top") items = items.filter(i => TOP_FOODS.includes(i.id));

  clientMenu.innerHTML = items.length
    ? items.map(i => {
      const name = i.name?.[lang] || i.name?.uz || i.name?.ru || i.name?.en || "—";
      const qty = cart[i.id]?.qty || 0;
      const isNew = isNewFood(i);
      const isTop = TOP_FOODS.includes(i.id);
      const catObj = CATEGORY_DATA.categories.find(c => c.id === i.category);
      const categoryName = catObj ? t(catObj.nameKey) : i.category;
      const subcategoryName = catObj?.sub?.includes(i.subcategory) ? t(i.subcategory) : "—";

      return `
      <div class="menu-card">
        ${isNew ? `<span class="badge new">🆕 ${t("badge_new")}</span>` : ""}
        ${isTop ? `<span class="badge top">🔥 ${t("badge_top")}</span>` : ""}
        <img src="${i.imgUrl || 'img/no-image.png'}" onerror="this.src='img/no-image.png'" alt="${t("food_image_alt")}">
        <h3>${name}</h3>
        <p>📂 ${categoryName} / ${subcategoryName}</p>
        <p>💰 ${i.price.toLocaleString()} ${t("currency")}</p>
        <div class="qty">
          <button onclick="changeQty('${i.id}', -1)">−</button>
          <span>${qty}</span>
          <button onclick="changeQty('${i.id}', 1)">+</button>
        </div>
      </div>
    `;
    }).join("")
    : `<p class="empty">${t("search_not_found")}</p>`;
}

/* =========================
   FILTER EVENTS
========================= */
function bindFilters() {
  filterCategory?.addEventListener("change", e => {
    filterCategoryValue = e.target.value;
    filterSubcategoryValue = "all";
    renderSubcategoryFilter();
    renderMenu();
  });

  filterSubcategory?.addEventListener("change", e => {
    filterSubcategoryValue = e.target.value;
    renderMenu();
  });

  filterTypeSelect?.addEventListener("change", e => {
    filterType = e.target.value;
    renderMenu();
  });

  searchInput?.addEventListener("input", e => {
    searchQuery = e.target.value.toLowerCase();
    renderMenu();
  });
}

/* =========================
   TARJIMALAR VA SAHIFA HOLATI
========================= */
function applyClientPageTranslations() {
  document.title = `Foodify — ${t("client_page_title")}`;

  const rawStatus = getOrderStatusKey(activeOrderData || {});

  if (activeOrderData?.readyAt) {
    updateHeaderReadyInfo(activeOrderData.readyAt);

    if (!shouldRunCountdownByStatus(rawStatus) && headerReadyCountdown) {
      headerReadyCountdown.innerText =
        t("waiting_chef_start") || "Oshpaz boshlashi kutilmoqda";
      headerReadyCountdown.style.color = "#64748b";
    }
  } else {
    clearHeaderReadyInfo();
  }
}

/* =========================
   BUYURTMA HOLATINI TIKLASH 
========================= */
async function restoreSubmittedOrderState() {
  const savedActiveOrderId = localStorage.getItem("activeOrderId");
  const savedTable = String(localStorage.getItem("table") || "").trim();
  const statusBox = document.getElementById("orderStatusBox");

  if (!savedActiveOrderId) {
    resetClientSession();
    return;
  }

  try {
    const snap = await get(ref(db, "orders/" + savedActiveOrderId));

    if (!snap.exists()) {
      resetClientSession();
      return;
    }

    const order = snap.val();
    const rawStatus = getOrderStatusKey(order);

    const isMine =
      String(order.clientId || "").trim() === String(clientId || "").trim() &&
      String(order.table || "").trim() === savedTable;

    const isAlive = !["yopildi", "bekor qilindi", "closed", "cancelled"].includes(normalizeStatus(rawStatus));

    if (!isMine || !isAlive || order.tableClosed === true) {
      resetClientSession();
      return;
    }

    currentOrderId = savedActiveOrderId;
    activeOrderData = { ...order, _id: savedActiveOrderId };
    hasSubmittedOrder = true;

    updateStatusUI(rawStatus);

  } catch (err) {
    console.error("restoreSubmittedOrderState error:", err);
    if (statusBox) statusBox.style.display = "none";
  }
}

/* =========================
   CHAT VA YORDAMCHI FUNKSIYALAR 
========================= */
let activeClientChatPath = "";
let stopClientChatListener = null;
let activeClientChatOrderId = "";

function stopClientChatRealtime() {
  if (stopClientChatListener) {
    stopClientChatListener();
    stopClientChatListener = null;
  }
  activeClientChatPath = "";
  activeClientChatOrderId = "";
}

function startClientChatRealtime(order) {
  if (!order || !order._id) return;

  const orderId = String(order._id).trim();
  const chefId = String(order.chefId || "").trim();

  if (!orderId || !chefId) return;

  const nextPath = `orderChats/${orderId}/chef`;

  if (
    activeClientChatOrderId === orderId &&
    activeClientChatPath === nextPath &&
    stopClientChatListener
  ) {
    return;
  }

  stopClientChatRealtime();

  activeClientChatOrderId = orderId;
  activeClientChatPath = nextPath;

  stopClientChatListener = onValue(
    ref(db, `${nextPath}/messages`),
    snap => {
      renderClientChatMessages(snap.val() || {});
    }
  );
}

function initClientChat() {
  if (!chatFab || !clientChatModal) return;

  chatFab.addEventListener("click", async () => {
    if (!currentOrderId) {
      alert(t("place_order_first"));
      return;
    }

    clientChatModal.style.display = "flex";
    await openClientChefChat();
  });

  clientChatSendBtn?.addEventListener("click", sendClientMessageToChef);

  clientChatInput?.addEventListener("keydown", async e => {
    if (e.key === "Enter") {
      e.preventDefault();
      await sendClientMessageToChef();
    }
  });

  clientChatModal.addEventListener("click", e => {
    if (e.target.id === "clientChatModal") {
      closeClientChat();
    }
  });
}

async function openClientChefChat() {
  const order = await getActiveOrderFresh();

  if (!order) {
    alert(t("active_order_not_found"));
    return;
  }

  if (!canClientAccessOrder(order)) {
    alert(t("own_order_only_chat"));
    return;
  }

  const chefId = String(order.chefId || "").trim();

  if (!chefId) {
    alert(t("chef_not_assigned"));
    return;
  }

  let chefName = getChefDefaultName();
  const chefSnap = await get(ref(db, "users/" + chefId));
  if (chefSnap.exists()) {
    chefName = chefSnap.val()?.name || chefName;
  }

  activeClientChatPath = `orderChats/${currentOrderId}/chef`;

  if (clientChatInfo) {
    clientChatInfo.innerHTML = `
  <b>👨‍🍳 ${escapeHTML(chefName)}</b><br>
  ${t("order_label")} #${order.orderNumber || "-"} | ${t("table_label")} ${order.table || "-"}
`;
  }

  await update(ref(db, activeClientChatPath + "/meta"), {
    orderId: currentOrderId,
    orderNumber: order.orderNumber || null,
    table: order.table || null,
    clientId,
    targetId: chefId,
    targetRole: "chef",
    chefName,
    updatedAt: Date.now(),
    status: "open"
  });

  startClientChatRealtime(order);
}

function renderClientChatMessages(messagesObj) {
  if (!clientChatMessages) return;

  const arr = Object.values(messagesObj || {})
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

  if (!arr.length) {
    clientChatMessages.innerHTML =
      `<div class="client-chat-empty">${t("no_messages_yet")}</div>`;
    return;
  }

  clientChatMessages.innerHTML = arr.map(msg => {
    const mine = msg.senderRole === "client";
    const sender =
      msg.senderRole === "chef"
        ? `👨‍🍳 ${escapeHTML(msg.senderName || t("chef_label"))}`
        : escapeHTML(msg.senderName || t("client_label"));

    return `
      <div class="client-chat-msg ${mine ? "mine" : "theirs"}">
        <div>${escapeHTML(msg.text || "")}</div>
        <div class="client-chat-meta">
          ${sender} • ${formatChatTime(msg.createdAt)}
        </div>
      </div>
    `;
  }).join("");

  clientChatMessages.scrollTop = clientChatMessages.scrollHeight;
}

async function sendClientMessageToChef() {
  const text = clientChatInput?.value.trim();
  if (!text) return;

  const order = await getActiveOrderFresh();
  if (!order || !canClientAccessOrder(order)) {
    alert(t("chat_not_yours"));
    return;
  }

  if (!activeClientChatPath) {
    await openClientChefChat();
    if (!activeClientChatPath) return;
  }

  await push(ref(db, activeClientChatPath + "/messages"), {
    text,
    senderId: clientId,
    senderRole: "client",
    senderName: getClientSenderName(order.table),
    orderId: currentOrderId,
    table: order.table || null,
    createdAt: Date.now()
  });

  await update(ref(db, activeClientChatPath + "/meta"), {
    orderId: currentOrderId,
    orderNumber: order.orderNumber || null,
    table: order.table || null,
    clientId,
    targetId: order.chefId || null,
    targetRole: "chef",
    lastMessage: text,
    lastSenderRole: "client",
    updatedAt: Date.now(),
    status: "open"
  });

  await update(ref(db, "orders/" + currentOrderId), {
    lastClientMessage: text,
    lastClientMessageAt: Date.now()
  });

  clientChatInput.value = "";
}

function closeClientChat(force = false) {
  if (clientChatModal) {
    clientChatModal.style.display = "none";
  }
  if (force) {
    stopClientChatRealtime();
  }
}

function canClientAccessOrder(order) {
  const myTable = String(localStorage.getItem("table") || tableNumber || "").trim();
  const myClientId = String(clientId || "").trim();

  if (!order) return false;

  return (
    String(order.clientId || "").trim() === myClientId &&
    String(order.table || "").trim() === myTable &&
    String(currentOrderId || "").trim() === String(order._id || currentOrderId || "").trim()
  );
}

function formatChatTime(ts) {
  const d = new Date(ts || Date.now());
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function getActiveOrderFresh() {
  if (!currentOrderId) return null;

  if (activeOrderData?._id === currentOrderId) {
    if (!canClientAccessOrder(activeOrderData)) return null;
    return activeOrderData;
  }

  const snap = await get(ref(db, "orders/" + currentOrderId));
  if (!snap.exists()) return null;

  const order = { ...snap.val(), _id: currentOrderId };

  if (!canClientAccessOrder(order)) return null;

  return order;
}

function escapeHTML(str = "") {
  return String(str).replace(/[&<>"']/g, s => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[s]));
}

function getClientSenderName(table) {
  return `${t("client_label")} (${t("table_label")} ${table || "-"})`;
}

function getChefDefaultName() {
  return t("chef_label");
}

function shouldRunCountdownByStatus(status) {
  const s = normalizeStatus(status);
  return s === "tayyorlanmoqda" || s === "cooking";
}

function playNotificationSound() {
  const audio = new Audio("/img/notify.wav");
  audio.play().catch(() => { });
}

/* =========================
   CART LOGIC
========================= */
function changeQty(id, delta) {
  if (!cart[id]) cart[id] = { qty: 0 };
  cart[id].qty += delta;
  if (cart[id].qty <= 0) delete cart[id];
  updateCart();
  renderMenu();
}

function removeFromCart(id) {
  delete cart[id];
  updateCart();
}

function updateCart() {
  if (!cartItems || !cartTotal || !cartCount) return;

  cartItems.innerHTML = "";
  let total = 0;
  let count = 0;
  const lang = getLang();

  Object.entries(cart).forEach(([id, c]) => {
    const m = allMenu[id];
    if (!m) return;
    const name = m.name?.[lang] || m.name?.uz || m.name?.ru || m.name?.en || "—";
    const sum = Number(m.price || 0) * Number(c.qty || 0);

    total += sum;
    count += c.qty;

    cartItems.innerHTML += `
  <div class="cart-item">
    <img src="${m.imgUrl || m.img || m.image || 'img/food.png'}" alt="food">
    <div class="cart-info">
      <b>${name}</b>
      <p>${c.qty} × ${m.price} = ${sum.toLocaleString()} ${t("currency")}</p>
    </div>
    <button onclick="removeFromCart('${id}')">❌</button>
  </div>
`;
  });

  const baseCookTime = calculateOrderCookTime(cart);
  currentBaseCookTime = baseCookTime;

  const result = calculatePriority(total, baseCookTime);
  cartTotal.innerText = result.finalTotal.toLocaleString();
  cartCount.innerText = count;

  const badge = document.getElementById("cartCount");
  if (badge) badge.style.display = count > 0 ? "flex" : "none";
}

function subscribeMenuRealtime() {
  onValue(ref(db, "menu"), snap => {
    allMenu = snap.val() || {};
    safeRenderMenu();
  });
}

let renderLock = false;
function safeRenderMenu() {
  if (renderLock) return;
  renderLock = true;
  requestAnimationFrame(() => {
    renderMenu();
    renderLock = false;
  });
}

/* =========================
   ORDER PLACEMENT
========================= */
async function createClientTimelineEvent(orderId, eventMessage) {
  const timelineRef = ref(db, `orderTimeline/${orderId}`);
  const newEvent = {
    orderId: orderId,
    eventType: "client_action",
    payload: { message: eventMessage },
    actorId: clientId,
    actorName: "Mijoz",
    actorRole: "client",
    createdAt: Date.now()
  };
  await push(timelineRef, newEvent);
}

window.currentRewardNote = "";
window.currentRewardDiscount = 0;

/* =========================
   BUYURTMA YUBORISH 
========================= */
async function sendOrder() {
  const tableOk = await checkTable();
  if (!tableOk) return;

  if (!Object.keys(cart).length) {
    alert("Savat bo'sh!");
    return;
  }

  const phoneInput = document.getElementById("clientPhoneInput");
  let rawPhone = phoneInput ? phoneInput.value.trim() : "";

  if (rawPhone && rawPhone.length < 9) {
    showNotification("❗ Telefon raqamni to'g'ri kiriting yoki anonim qolish uchun bo'sh qoldiring!");
    return;
  }

  let visitCount = 0;
  let phoneKey = "";

  if (rawPhone) {
    phoneKey = rawPhone.replace(/\D/g, "").slice(-9);
    const clientRef = ref(db, "clients/" + phoneKey);
    const clientSnap = await get(clientRef);
    if (clientSnap.exists()) {
      visitCount = (clientSnap.val().visits || 0) + 1;
    } else {
      visitCount = 1;
    }
    await update(clientRef, { phone: phoneKey, visits: visitCount, lastVisit: Date.now() });
  }

  const tableStr = String(confirmedTableNumber || localStorage.getItem("confirmedTable") || tableNumber || "").trim();

  let total = 0;
  const items = {};
  Object.entries(cart).forEach(([id, c]) => {
    const m = allMenu[id];
    if (!m) return;
    const price = Number(m.price || 0);
    const qty = Number(c.qty || 0);
    total += price * qty;
    items[id] = { id, name: m.name, price, qty, img: m.imgUrl || "img/no-image.png", prepTime: Number(m.prepTime || 30) };
  });

  localStorage.removeItem("discountPercent");
  localStorage.removeItem("discountCode");

  const now = Date.now();
  const baseCookTime = calculateOrderCookTime(items);
  const readyAt = now + baseCookTime * 60000;

  const counterRef = ref(db, "meta/orderCounter");
  const res = await runTransaction(counterRef, n => (n || 0) + 1);
  const orderNumber = res.snapshot.val();

  const newOrderRef = push(ref(db, "orders"));
  const newOrderId = newOrderRef.key;

  await set(newOrderRef, {
    orderNumber,
    table: tableStr,
    clientPhone: phoneKey,
    clientVisits: visitCount,
    items,
    total,
    originalTotal: total,
    priority: "normal",
    cookTime: baseCookTime,
    baseCookTime,
    readyAt,
    status: ORDER_STATUS ? ORDER_STATUS.QUEUE : "queue",
    statusKey: ORDER_STATUS ? ORDER_STATUS.QUEUE : "queue",
    statusLabel: "Navbatda",
    createdAt: now,
    clientId,
    chefId: null
  });

  await set(ref(db, "tables/" + tableStr), {
    status: "busy", busy: true, orderId: newOrderId, openedAt: Date.now()
  });

  if (phoneKey) {
    await createClientTimelineEvent(newOrderId, `Mijoz (Tashrif: ${visitCount}-marta).`);
  }

  currentOrderId = newOrderId;
  activeOrderData = null;
  baseReadyAt = readyAt;
  localStorage.setItem("activeOrderId", newOrderId);
  localStorage.setItem("clientCart", JSON.stringify(cart));
  hasSubmittedOrder = false;
  sessionStorage.removeItem(SUBMITTED_ORDER_FLAG);

  const statusBox = document.getElementById("orderStatusBox");
  if (statusBox) statusBox.style.display = "none";

  stopClientCountdown();
  setPreviewReadyInfo(readyAt);
  listenActiveOrder();

  openPayment(total, orderNumber, items, baseCookTime, phoneKey);
}

/* =========================
   PAYMENT LOGIC
========================= */
window.confirmPayment = async function () {
  const method = document.getElementById("paymentMethod")?.value || "cash";
  const selectedPriority = document.querySelector("input[name='priority']:checked")?.value || "normal";

  if (!currentOrderId) { alert(t("order_not_found")); return; }

  const result = calculatePriority(currentPaymentTotal, currentBaseCookTime);

  let finalTotal = result.finalTotal;
  let totalDiscount = 0;

  const discountPercent = Number(localStorage.getItem("discountPercent") || 0);

  if (discountPercent > 0 && !result.isFast) {
    totalDiscount = Math.round(finalTotal * discountPercent / 100);
    finalTotal -= totalDiscount;
  } else if (window.currentRewardDiscount > 0 && !result.isFast) {
    totalDiscount = window.currentRewardDiscount;
    finalTotal -= totalDiscount;
  }

  const recalculatedReadyAt = Date.now() + result.cookTime * 60000;

  await update(ref(db, "orders/" + currentOrderId), {
    total: finalTotal,
    finalTotal: finalTotal,
    originalTotal: currentPaymentTotal,
    fastFeeAmount: result.extraMoney || 0,
    discountAmount: totalDiscount || 0,
    priority: selectedPriority,
    cookTime: result.cookTime,
    baseCookTime: currentBaseCookTime,
    readyAt: recalculatedReadyAt,
    updatedAt: Date.now()
  });

  await update(ref(db, "orders/" + currentOrderId + "/payment"), {
    method,
    requested: true,
    paid: false,
    time: Date.now(),
    requestedAt: Date.now()
  });

  const orderSnap = await get(ref(db, "orders/" + currentOrderId));
  if (orderSnap.exists()) {
    await set(ref(db, "tables/" + orderSnap.val().table), {
      status: "busy",
      busy: true,
      orderId: currentOrderId,
      openedAt: Date.now()
    });
  }

  hasSubmittedOrder = true;
  sessionStorage.setItem("client_has_submitted_order", "1");
  updateStatusUI("queue");
  listenActiveOrder();

  const code = localStorage.getItem("discountCode");
  if (code) {
    await update(ref(db, "discounts/" + code), { used: true });
    localStorage.removeItem("discountCode");
    localStorage.removeItem("discountPercent");
  }

  allowReceiptOpen = true;
  localStorage.setItem("receiptPendingOrderId", currentOrderId);

  showNotification("To'lov so'rovi yuborildi");
  closePayment();
};

function calculateOrderCookTime(itemsObj) {
  let maxPrep = 0;
  Object.entries(itemsObj || {}).forEach(([id, item]) => {
    const prep = Number(allMenu?.[id]?.prepTime || item?.prepTime || 30);
    if (prep > maxPrep) maxPrep = prep;
  });
  return maxPrep || 30;
}

/* =========================
   VAQT VA NARXNI HISBLASH 
========================= */
function calculatePriority(total, baseCookTime = 30) {
  const selectedPriority = document.querySelector("input[name='priority']:checked")?.value || "normal";
  let finalTotal = total;

  let cookTime = RESTAURANT_SETTINGS.normalOrderBaseTime || baseCookTime;

  let extraMoney = 0;
  let isFast = false;

  const meetsMinAmount = total >= (RESTAURANT_SETTINGS.fastOrderMinAmount || 80000);

  if (selectedPriority === "fast" && RESTAURANT_SETTINGS.fastOrderActive !== false && meetsMinAmount) {
    const percent = RESTAURANT_SETTINGS.fastFee || 5;
    const minusMins = RESTAURANT_SETTINGS.fastOrderMinusMinutes || 10;

    extraMoney = Math.round(total * percent / 100);
    finalTotal = total + extraMoney;
    cookTime = Math.max(cookTime - minusMins, 5);
    isFast = true;
  }

  return { finalTotal, cookTime, extraMoney, isFast };
}

/* =========================
   TO'LOV SUMMASINI YANGILASH VA EKRANGA CHIQARISH
========================= */
window.updatePaymentSummary = function () {
  const result = calculatePriority(currentPaymentTotal, currentBaseCookTime);
  const discountPercent = Number(localStorage.getItem("discountPercent") || 0);

  let total = result.finalTotal;
  let discountAmount = 0;

  if (discountPercent > 0 && !result.isFast) {
    discountAmount = Math.round(total * discountPercent / 100);
    total -= discountAmount;
  } else if (window.currentRewardDiscount > 0 && !result.isFast) {
    discountAmount = window.currentRewardDiscount;
    total -= discountAmount;
  }

  const paymentTotalEl = document.getElementById("paymentTotal");
  const breakdown = document.getElementById("priceBreakdown");

  if (paymentTotalEl) paymentTotalEl.innerText = total.toLocaleString() + " " + t("currency");

  if (breakdown) {
    const percent = RESTAURANT_SETTINGS.fastFee || 5;

    breakdown.innerHTML = `
      <div style="display:flex;justify-content:space-between; margin-bottom:5px;">
        <span>Asosiy narx:</span>
        <span>${Number(currentPaymentTotal).toLocaleString()} ${t("currency")}</span>
      </div>

      ${result.isFast ? `
        <div style="display:flex;justify-content:space-between;color:#dc3545; font-weight:bold; margin-bottom:5px;">
          <span>⚡ Tezkor xizmat (+${percent}%)</span>
          <span>+${result.extraMoney.toLocaleString()} ${t("currency")}</span>
        </div>
      ` : ""}

      ${discountAmount > 0 ? `
        <div style="display:flex;justify-content:space-between;color:#28a745; font-weight:bold;">
          <span>🎁 Chegirma:</span>
          <span>-${discountAmount.toLocaleString()} ${t("currency")}</span>
        </div>
      ` : ""}
    `;
  }

  const newReadyAt = Date.now() + result.cookTime * 60000;

  const readyEl = document.querySelector(".payment-ready-time") || document.getElementById("clientReadyTime");
  const countdownEl = document.querySelector(".payment-countdown") || document.getElementById("clientTimer");

  const dt = new Date(newReadyAt);
  const timeString = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (readyEl) readyEl.innerHTML = `🍽 Tayyor bo'ladi: <b>${timeString}</b>`;
  if (countdownEl) countdownEl.innerHTML = `⏳ Kutilmoqda: <b>${result.cookTime} daqiqa</b>`;
};

/* =========================
   TO'LOV OYNASINI OCHISH 
========================= */
window.currentPaymentPhoneKey = "";

function openPayment(total, orderNumber, orderItems = null, baseCookTime = 30, phoneKey = "") {
  currentPaymentTotal = Number(total || 0);
  currentBaseCookTime = Number(baseCookTime || 30);
  window.currentPaymentPhoneKey = phoneKey;

  const normalRadio = document.querySelector("input[name='priority'][value='normal']");
  const fastRadio = document.querySelector("input[name='priority'][value='fast']");

  if (normalRadio) normalRadio.checked = true;

  const fastOption = document.getElementById("fastOption");
  if (fastOption) {
    const isFastEnabled = RESTAURANT_SETTINGS.fastOrderActive !== false;
    const meetsMinAmount = currentPaymentTotal >= (RESTAURANT_SETTINGS.fastOrderMinAmount || 80000);
    fastOption.style.display = (isFastEnabled && meetsMinAmount) ? "block" : "none";
  }

  document.querySelectorAll("input[name='priority']").forEach(radio => {
    radio.onchange = null;
    radio.addEventListener("change", () => {
      window.updatePaymentSummary();
    });
  });

  const modal = document.getElementById("paymentModal");
  if (!modal) return;
  modal.style.display = "flex";

  const paymentOrderIdEl = document.getElementById("paymentOrderId");
  if (paymentOrderIdEl) {
    paymentOrderIdEl.innerText = `№ ${orderNumber} | ${t("table_label")} ${tableNumber}`;
  }

  const list = document.getElementById("paymentItems");
  if (list) {
  }

  const breakdown = document.getElementById("priceBreakdown");
  if (breakdown) {
    if (!document.getElementById("myPromosContainer")) {
      const promoDiv = document.createElement("div");
      promoDiv.id = "myPromosContainer";
      promoDiv.style.marginTop = "15px";
      breakdown.parentNode.insertBefore(promoDiv, breakdown);
    }
  }

  updatePaymentSummary();

  if (window.currentPaymentPhoneKey) {
    fetchAndRenderMyPromos(window.currentPaymentPhoneKey);
  }
}

async function fetchAndRenderMyPromos(phone) {
  const container = document.getElementById("myPromosContainer");
  if (!container) return;
  container.innerHTML = "<p style='font-size:13px; color:#666;'>⏳ Promokodlar qidirilmoqda...</p>";

  const snap = await get(ref(db, "discounts"));
  const allDiscounts = snap.val() || {};

  const myPromos = Object.values(allDiscounts).filter(d => d.ownerPhone === phone && d.used === false);

  if (myPromos.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
        <div style="background: #eef8ee; padding: 10px; border-radius: 8px; margin-bottom: 15px;">
            <h4 style="margin-top:0; color:#28a745; font-size:14px;">🎫 Sizning shaxsiy promokodlaringiz</h4>
            ${myPromos.map(p => `
                <div style="background:#fff; border:1px solid #c3e6cb; padding:10px; border-radius:6px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="color:#28a745; font-size:16px;">${p.code}</strong> <br>
                        <span style="font-size:12px; color:#555;">-${p.percent}% chegirma beradi</span>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:5px;">
                        <button onclick="applyMyPromo('${p.code}', ${p.percent})" style="background:#28a745; color:#fff; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-weight:bold;">Qo'llash</button>
                        <button onclick="giftPromoCode('${p.code}')" style="background:#ffc107; color:#000; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:12px;">Do'stimga berish</button>
                    </div>
                </div>
            `).join("")}
        </div>
    `;
}

window.applyMyPromo = function (code, percent) {
  localStorage.setItem("discountPercent", percent);
  localStorage.setItem("discountCode", code);
  showNotification(`✅ Promokod qo'llanildi: -${percent}%`);
  updatePaymentSummary();
};

window.giftPromoCode = async function (code) {
  const newPhone = prompt("Do'stingizning telefon raqamini kiriting (+998...):");
  if (!newPhone) return;

  const cleanPhone = newPhone.replace(/\D/g, "").slice(-9);
  if (cleanPhone.length < 9) {
    alert("Noto'g'ri raqam kiritildi! Faqat 9 xonali raqam kiriting.");
    return;
  }

  await update(ref(db, `discounts/${code}`), {
    ownerPhone: cleanPhone
  });

  showNotification(`🎁 Promokod muvaffaqiyatli ${cleanPhone} raqamiga yuborildi!`);

  if (localStorage.getItem("discountCode") === code) {
    localStorage.removeItem("discountCode");
    localStorage.removeItem("discountPercent");
    updatePaymentSummary();
  }

  fetchAndRenderMyPromos(window.currentPaymentPhoneKey);
};

function closePayment() {
  const modal = document.getElementById("paymentModal");
  if (modal) modal.style.display = "none";
}

async function loadMyPromos(phone) {
  const promoListEl = document.getElementById("availablePromos");
  if (!promoListEl || !phone) return;

  const snap = await get(ref(db, "clients/" + phone + "/myPromos"));
  if (snap.exists()) {
    const promos = snap.val();
    promoListEl.innerHTML = "<h4>Mening promokodlarim:</h4>";
    Object.entries(promos).forEach(([id, p]) => {
      if (p.status === "active") {
        promoListEl.innerHTML += `
          <div class="promo-item" onclick="applyPromo('${p.code}', ${p.percent})">
            <span>${p.code} (-${p.percent}%)</span>
            <button onclick="event.stopPropagation(); giftPromo('${id}', '${p.code}')">🎁 Sovg'a qilish</button>
          </div>`;
      }
    });
  }
}

window.applyPromo = function (code, percent) {
  localStorage.setItem("discountPercent", percent);
  localStorage.setItem("discountCode", code);
  updatePaymentSummary();
  showNotification(`✅ ${code} promokodi kiritildi!`);
};

window.giftPromo = async function (promoId, code) {
  const targetPhone = prompt("Promokodni kimga bermoqchisiz? (Telefon raqamini yozing):");
  if (!targetPhone || targetPhone.length < 9) {
    alert("Noto'g'ri telefon raqami!");
    return;
  }

  const targetKey = targetPhone.replace(/\D/g, "").slice(-9);
  const myPhone = document.getElementById("clientPhoneInput").value.replace(/\D/g, "").slice(-9);

  await remove(ref(db, `clients/${myPhone}/myPromos/${promoId}`));

  const snap = await get(ref(db, "promocodes/" + code));
  if (snap.exists()) {
    const pData = snap.val();
    const newPromoId = "promo_" + Date.now();

    await update(ref(db, `clients/${targetKey}/myPromos/${newPromoId}`), {
      code: code,
      percent: pData.percent,
      status: "active"
    });
    await update(ref(db, "promocodes/" + code), { ownerPhone: targetKey });

    alert(`🎁 Promokod ${targetKey} raqamiga muvaffaqiyatli o'tkazildi!`);
    loadMyPromos(myPhone);
  }
};

/* =========================
   TABLES & MISC
========================= */
async function checkTable() {
  const input = document.getElementById("tableInput");
  const value = String(input?.value || confirmedTableNumber || localStorage.getItem("table") || "").trim();

  if (!value) {
    setTableStatusMessage("Stol raqamini kiriting", "error");
    return false;
  }

  const prevTable = localStorage.getItem("table");
  if (prevTable && prevTable !== value) {
    resetClientSession();
    if (input) input.value = value;
  }

  const tableSnap = await get(ref(db, "tables/" + value));
  const tableData = tableSnap.exists() ? (tableSnap.val() || {}) : {};

  const isBusy = tableData.status === "busy" || tableData.status === "open" || tableData.busy === true;
  const sameCurrentOrder = String(tableData.orderId || "") === String(currentOrderId || "");

  if (isBusy && !sameCurrentOrder) {
    setTableStatusMessage("Bu stol ayni paytda band!", "error");
    return false;
  }

  tableNumber = value;
  confirmedTableNumber = value;
  localStorage.setItem("table", value);
  localStorage.setItem("confirmedTable", value);
  if (input) input.value = value;
  setTableStatusMessage("Tasdiqlandi", "success");
  return true;
}

function setTableStatusMessage(text, type = "error") {
  const tableStatus = document.getElementById("tableStatus");
  if (!tableStatus) return;
  tableStatus.textContent = text || "";
  tableStatus.className = `table-status-msg ${type}`;
}

function showNotification(text) {
  const n = document.getElementById("notification");
  if (!n) return;
  n.innerText = text;
  n.classList.add("show");
  setTimeout(() => n.classList.remove("show"), 3000);
}

function toggleCart() {
  if (cartModal) cartModal.style.display = cartModal.style.display === "block" ? "none" : "block";
}

function isNewFood(item) {
  if (!item?.createdAt) return false;
  return Date.now() - item.createdAt < 3 * 24 * 60 * 60 * 1000;
}

function getTranslatedItemName(item, menuItem = null, lang = getLang()) {
  const target = menuItem?.name || item?.name;
  if (typeof target === "object") return target[lang] || target.uz || target.ru || target.en || "—";
  return target || "—";
}

/* =========================
   LISTEN ACTIVE ORDER 
========================= */
function listenActiveOrder() {
  const activeId = localStorage.getItem("activeOrderId");
  if (!activeId) return;

  stopActiveOrderListener = onValue(ref(db, "orders/" + activeId), snap => {
    const order = snap.val();

    if (!order) {
      resetClientSession();
      return;
    }

    activeOrderData = { ...order, _id: activeId };
    const rawStatus = getOrderStatusKey(order);

    const isAlive = !["yopildi", "bekor qilindi", "closed", "cancelled"].includes(normalizeStatus(rawStatus));

    if (!isAlive || order.tableClosed === true) {
      resetClientSession();
      showNotification(rawStatus.includes("yopildi") || rawStatus.includes("closed") ? "Xaridingiz uchun rahmat!" : "Buyurtma bekor qilindi");
      return;
    }

    hasSubmittedOrder = true;
    updateStatusUI(rawStatus);

    const isReceiptReady = (order.payment?.paid === true || order.payment?.approved === true);
    const alreadyShown = localStorage.getItem("receiptShown");

    if (isReceiptReady && alreadyShown !== activeId) {
      localStorage.setItem("receiptShown", activeId);
      setTimeout(() => {
        showReceipt(order);
      }, 500);
    }
  });
}

/* =========================
   CHEK (RECEIPT) FUNKSIYALARI 
========================= */
function showReceipt(order) {
  const box = document.getElementById("receiptBox");
  const content = document.getElementById("receiptContent");

  if (!box || !content) return;

  if (!order || !order.items) return;

  const lang = getLang();
  const currency = t("currency") || "UZS";
  const restaurantName = RESTAURANT_SETTINGS.restaurantName || "Restoran nomi va manzili";

  const subtotal = Number(order.originalTotal || 0);
  const fastFee = Number(order.fastFeeAmount || 0);
  const discount = Number(order.discountAmount || 0);
  const finalTotal = Number(order.total || order.finalTotal || 0);

  const orderDate = new Date(order.createdAt || Date.now());
  const dateStr = orderDate.toLocaleDateString('ru-RU').replace(/\./g, '-');
  const timeStr = orderDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let itemsHtml = Object.values(order.items).map(i => {
    const menuItem = allMenu[i.id || i.menuId || i.itemId] || {};
    const name = getTranslatedItemName(i, menuItem, lang);
    const price = Number(i.price || 0);
    const qty = Number(i.qty || 0);
    const sum = price * qty;

    return `
      <div style="display:flex; justify-content:space-between; font-size: 13px; margin-bottom: 4px;">
        <div style="flex:2.5; text-align:left; word-wrap: break-word; padding-right: 5px;">${name}</div>
        <div style="flex:1; text-align:center;">${qty.toFixed(1)}</div>
        <div style="flex:1.5; text-align:right;">${sum.toLocaleString()}</div>
      </div>
    `;
  }).join("");

  content.innerHTML = `
    <div class="receipt-wrapper" style="padding: 20px; display: flex; flex-direction: column; align-items: center;">
      
      <div id="real-receipt" style="background: #fff; width: 100%; max-width: 340px; padding: 20px; font-family: 'Courier New', Courier, monospace; color: #000; box-shadow: 0 4px 15px rgba(0,0,0,0.2); font-size: 13px; line-height: 1.4;">
        
        <div style="text-align: center; margin-bottom: 20px;">
  <img src="img/logo.png" alt="Logo" style="max-width: 120px; height: auto;" />
</div>  

        <div style="margin-bottom: 15px;">
          <div style="display:flex; justify-content:space-between;">
            <span>Chek # ${order.orderNumber || String(order._id).substring(0, 6) || "—"}</span>
            <span>Stol # ${order.table ?? "-"}</span>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span>${dateStr} Ochildi ${timeStr}</span>
          </div>
          <div style="margin-top: 5px;">Xurmatli mijoz</div>
        </div>

        <div style="border-bottom: 1px dashed #000; margin-bottom: 5px;"></div>
        <div style="display:flex; justify-content:space-between; font-weight: bold; margin-bottom: 5px;">
          <div style="flex:2.5; text-align:left;">Taom</div>
          <div style="flex:1; text-align:center;">Miqdor</div>
          <div style="flex:1.5; text-align:right;">Summa</div>
        </div>
        <div style="border-bottom: 1px dashed #000; margin-bottom: 10px;"></div>

        <div style="margin-bottom: 10px;">
          ${itemsHtml}
        </div>

        <div style="border-top: 1px dashed #000; padding-top: 10px; margin-bottom: 10px;">
          <div style="display:flex; justify-content:space-between;">
            <span>Asosiy:</span>
            <span>${subtotal.toLocaleString()}</span>
          </div>
          ${fastFee > 0 ? `
          <div style="display:flex; justify-content:space-between;">
            <span>Tezkor xizmat:</span>
            <span>+${fastFee.toLocaleString()}</span>
          </div>` : ""}
          ${discount > 0 ? `
          <div style="display:flex; justify-content:space-between;">
            <span>Chegirma:</span>
            <span>-${discount.toLocaleString()}</span>
          </div>` : ""}
        </div>

        <div style="border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 10px 0; margin-bottom: 15px; display:flex; justify-content:space-between; font-size: 15px;">
          <span>Jami:</span>
          <span>${finalTotal.toLocaleString()}</span>
        </div>

        <div style="display:flex; justify-content:space-between; margin-bottom: 20px; font-weight: bold;">
          <span>To'lov turi (${currency.toUpperCase()}):</span>
          <span>${finalTotal.toLocaleString()}</span>
        </div>

        <div style="text-align: center; font-size: 12px; margin-top: 10px;">
          Xaridingiz uchun rahmat!<br>
          Xizmat ko'rsatishdan mamnunmiz.
        </div>
      </div>
      <div style="display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; justify-content: center;">
        <button onclick="downloadReceiptPNG()" style="background: #28a745; color: white; padding: 10px 15px; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 5px;">
          🖼 PNG Yuklash
        </button>
        <button onclick="downloadReceiptPDF()" style="background: #007bff; color: white; padding: 10px 15px; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 5px;">
          📄 PDF Yuklash
        </button>
        <button onclick="closeReceipt()" style="background: #dc3545; color: white; padding: 10px 15px; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 5px;">
          ✖ Yopish
        </button>
      </div>
    </div>
  `;

  box.style.display = "flex";
}

function closeReceipt() {
  const box = document.getElementById("receiptBox");
  const content = document.getElementById("receiptContent");
  if (box) box.style.display = "none";
  if (content) content.innerHTML = "";
}

window.downloadReceiptPNG = function () {
  const element = document.getElementById("real-receipt");
  if (!element) { alert(t("receipt_not_found") || "Chek topilmadi!"); return; }

  if (typeof html2canvas === 'undefined') {
    alert("Yuklab olish tizimi ishga tushmadi. Sahifani yangilang.");
    return;
  }

  html2canvas(element, { scale: 3, useCORS: true, backgroundColor: "#ffffff" }).then(canvas => {
    const link = document.createElement("a");
    link.download = `Chek_${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }).catch(err => {
    console.error("PNG yuklash xatosi:", err);
    alert(t("png_download_failed") || "Xatolik yuz berdi!");
  });
};

window.downloadReceiptPDF = function () {
  const element = document.getElementById("real-receipt");
  if (!element) { alert(t("receipt_not_found") || "Chek topilmadi!"); return; }

  if (typeof html2pdf === 'undefined') {
    alert("Yuklab olish tizimi ishga tushmadi. Sahifani yangilang.");
    return;
  }

  const opt = {
    margin: 5,
    filename: `Chek_${Date.now()}.pdf`,
    image: { type: "jpeg", quality: 1 },
    html2canvas: { scale: 3, useCORS: true, backgroundColor: "#ffffff" },
    jsPDF: { unit: "mm", format: [80, 200], orientation: "portrait" }
  };

  html2pdf().set(opt).from(element).save();
};

window.showReceipt = showReceipt;
window.closeReceipt = closeReceipt;

function generateDiscountCode() {
  return "DISC" + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function updateStatusUI(status) {
  const orderStatusBox = document.getElementById("orderStatusBox");
  if (!hasSubmittedOrder || !orderStatusBox) return;

  const raw = normalizeStatus(status);

  if (raw === "tasdiqlandi" || raw === "approved") {
    if (activeOrderData && activeOrderData.payment?.paid !== true && activeOrderData.payment?.approved !== true) {
      return;
    }
  }

  const statusMap = {
    yangi: { key: "new", icon: "🆕", color: "#6c757d" },
    tasdiqlandi: { key: "approved", icon: "✅", color: "#28a745" },
    tayyorlanmoqda: { key: "cooking", icon: "🔥", color: "#fd7e14" },
    tayyor: { key: "ready", icon: "🍽️", color: "#17a2b8" },
    yopildi: { key: "closed", icon: "📦", color: "#6f42c1" },
    "bekor qilindi": { key: "cancelled", icon: "❌", color: "#dc3545" },
    queue: { key: "queue", icon: "🕓", color: "#6c757d" }
  };

  const info = statusMap[raw] || { key: "unknown", icon: "⏳", color: "#6c757d" };
  orderStatusBox.style.display = "block";
  document.getElementById("orderStatus").innerHTML = `
      <div style="font-size:13px;color:#666;margin-bottom:6px;">Status:</div>
      <div style="font-weight:700;color:${info.color};font-size:18px;">
          ${info.icon} ${t("status_" + info.key) || status}
      </div>
  `;
}

/* =========================
EXPORT TO WINDOW
========================= */
window.toggleCart = toggleCart;
window.sendOrder = sendOrder;
window.changeQty = changeQty;
window.removeFromCart = removeFromCart;
window.confirmPayment = confirmPayment;
window.closePayment = closePayment;
window.openPayment = openPayment;
window.closeReceipt = closeReceipt;
window.closeClientChat = closeClientChat;
window.checkTable = checkTable;