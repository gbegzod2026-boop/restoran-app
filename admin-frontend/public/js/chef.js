// chef.js
import { CATEGORY_DATA } from "./shared.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  update,
  get,
  set,
  push,
  remove
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

window.updateGlobalChefTime = async function (mins) {
  await update(ref(db, "settings"), { normalOrderBaseTime: Number(mins) });
};

window.toggleGlobalFastOrder = async function (isActive) {
  await update(ref(db, "settings"), { fastOrderActive: isActive });
};
/* =========================
   CONFIG
========================= */
const firebaseConfig = {
  apiKey: "AIzaSyCGCCIP3eFg40bOEENDLGcrw9c484ySCHQ",
  authDomain: "restoran-30d51.firebaseapp.com",
  databaseURL: "https://restoran-30d51-default-rtdb.firebaseio.com",
  projectId: "restoran-30d51",
  storageBucket: "restoran-30d51.firebasestorage.app",
  messagingSenderId: "862261129762",
  appId: "1:862261129762:web:5577e6821b4ad7ea4e507b"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getDatabase(app);

/* =========================
   STATE
========================= */
let chefActive = true;
let allOrders = {};
let currentLang = localStorage.getItem("lang") || "uz";
let currentChefId = getStoredChefId();
const PERSONAL_CHEF_ROOM = currentChefId ? `dm_${currentChefId}` : "dm_unknown";
let currentChefChatRoom = localStorage.getItem("chefChatRoom") || PERSONAL_CHEF_ROOM;
let orderCountdownInterval = null;
let lastOrdersSignature = "";
let socketConnected = false;

// Listener cleanup registry
window.listeners = {};
window.addEventListener('beforeunload', () => {
  Object.values(window.listeners || {}).forEach(unsub => unsub?.());
});

window.allChefs = {};
window.allMenu = {};
window.orderChatsByOrder = {};
window.chefChats = {};
window.tableStates = {};
window.delayedAlertedOrders = window.delayedAlertedOrders || new Set();

// Enhancement globals
window.kitchenAuditLogs = window.kitchenAuditLogs || [];
window.kitchenNotifications = window.kitchenNotifications || [];
window.stopList = window.stopList || {};
window.orderTimelines = window.orderTimelines || {};
window.chefSettings = window.chefSettings || {};
window.__stopListAlertedOrders = window.__stopListAlertedOrders || new Set();
window.__kitchenNotificationTimer = null;
window.__kitchenRealtimeTimer = null;
window.__kitchenTickerTimer = null;

if (localStorage.getItem("role") !== "chef") {
  location.href = "login.html";
}

function getStoredChefId() {
  return String(
    localStorage.getItem("chefId") ||
    localStorage.getItem("userId") ||
    localStorage.getItem("uid") ||
    localStorage.getItem("currentUserId") ||
    localStorage.getItem("id") ||
    ""
  ).trim();
}

if (!currentChefId) {
  console.error("Chef ID topilmadi");
  alert(window.LANGS?.[currentLang]?.chef_id_not_found || "Oshpaz ID topilmadi. Qayta login qiling.");
  location.href = "login.html";
}

/* =========================
   OPTIONAL SOCKET.IO
========================= */
const SOCKET_URL =
  localStorage.getItem("socketUrl") ||
  document.documentElement.dataset.socketUrl ||
  window.location.origin;

const socket = typeof window.io === "function"
  ? window.io(SOCKET_URL, {
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true
  })
  : null;

function emitSocket(eventName, payload) {
  if (!socket || !socketConnected) return;
  try {
    socket.emit(eventName, payload);
  } catch (err) {
    console.warn("Socket emit xatolik:", err);
  }
}

function listenSocket() {
  if (!socket) return;

  socket.on("connect", () => {
    socketConnected = true;
    emitSocket("chef:join", {
      chefId: currentChefId,
      chefName: localStorage.getItem("name") || "Chef",
      role: "chef"
    });
    showNotification(`🟢 ${t("socket_connected")}`);
  });

  socket.on("disconnect", () => {
    socketConnected = false;
    showNotification(`🟡 ${t("socket_disconnected")}`);
  });

  socket.on("chef:new-order", payload => {
    if (!payload) return;
    const targetChefId = String(payload.chefId || "").trim();
    if (targetChefId && targetChefId === String(currentChefId)) {
      playSound();
      showNotification(`🆕 ${t("new_order_arrived")}: #${payload.orderNumber || payload.orderId || ""}`);
    }
  });

  socket.on("chef:status-updated", payload => {
    if (!payload?.orderId) return;
    showNotification(`🔄 ${t("status_label")}: ${payload.statusLabel || payload.status || ""}`);
  });

  socket.on("chef:chat-message", payload => {
    if (!payload) return;
    if (payload.senderId !== currentChefId) {
      playSound();
      showNotification(`💬 ${payload.senderName || t("chef_label")}: ${payload.text || ""}`);
    }
  });

  socket.on("chef:table-update", payload => {
    if (!payload?.table) return;
    window.tableStates[String(payload.table)] = {
      ...(window.tableStates[String(payload.table)] || {}),
      ...payload,
      updatedAt: Date.now()
    };
    renderTableStatusBoard();
  });
}

/* =========================
   DOM
========================= */
function ensureDynamicLayout() {
  const main = document.querySelector("main.container");
  const header = document.querySelector("header.chef-header");
  if (!main || !header) return;

  if (!document.getElementById("tableStatusBoard")) {
    const board = document.createElement("div");
    board.id = "tableStatusBoard";
    board.className = "table-status-board";
    header.insertAdjacentElement("afterend", board);
  }

  if (!document.getElementById("chefChatDock")) {
    const section = document.createElement("section");
    section.id = "chefChatDock";
    section.className = "chef-chat-dock";
    section.innerHTML = `
      <div class="chef-chat-panel">
        <div class="chef-chat-sidebar">
          <div class="chef-chat-sidebar-head">💬 ${t("chef_chat_title")}</div>
          <div id="chefChatRooms" class="chef-chat-rooms"></div>
        </div>
        <div class="chef-chat-main">
          <div class="chef-chat-main-head" id="chefChatTitle">${t("chef_chat_kitchen")}</div>
          <div id="chefChatMessages" class="chef-chat-messages"></div>
          <div class="chef-chat-form">
            <input id="chefChatInput" type="text" placeholder="${t("chef_chat_placeholder")}" />
            <button id="chefChatSendBtn" type="button">${t("send_message")}</button>
          </div>
        </div>
      </div>
    `;
    main.insertAdjacentElement("afterend", section);
  }
}

function ensureChefEnhancementLayout() {
  const header = document.querySelector(".chef-header");
  const main = document.querySelector("main.container");
  if (!header || !main) return;

  if (!document.getElementById("chefExtraFilters")) {
    const row = document.createElement("div");
    row.id = "chefExtraFilters";
    row.className = "chef-extra-filters";
    row.innerHTML = `
      <div class="chef-extra-filter-row">
        <select id="chefStatusFilter">
          <option value="all">${t("all_statuses") || "Barcha statuslar"}</option>
          <option value="new">${t("status_new") || "Yangi"}</option>
          <option value="accepted">${t("status_approved") || "Tasdiqlangan"}</option>
          <option value="cooking">${t("status_cooking") || "Tayyorlanmoqda"}</option>
          <option value="ready">${t("status_ready") || "Tayyor"}</option>
          <option value="delayed">${t("delayed_order") || "Kechikkan"}</option>
          <option value="mine">${t("my_orders") || "Mening orderlarim"}</option>
        </select>
        <input id="chefTableFilter" type="text" placeholder="${t("table_number") || "Stol raqami..."}" />
        <input id="chefSearchInput" type="search" placeholder="${t("search_order_food") || "Order / taom / note qidirish..."}" />
      </div>
    `;
    header.insertAdjacentElement("afterend", row);
  }

  if (!document.getElementById("chefWidgetsRow")) {
    const row = document.createElement("section");
    row.id = "chefWidgetsRow";
    row.className = "chef-widgets-row";
    row.innerHTML = `
      <div id="kitchenNotificationsPanel" class="chef-widget-card"></div>
      <div id="stopListBoard" class="chef-widget-card"></div>
      <div id="kitchenAuditList" class="chef-widget-card"></div>
    `;
    main.insertAdjacentElement("beforebegin", row);
  }

  if (!document.getElementById("chefDetailModal")) {
    const modal = document.createElement("div");
    modal.id = "chefDetailModal";
    modal.className = "chef-detail-modal";
    modal.style.display = "none";
    modal.innerHTML = `
      <div class="chef-detail-dialog">
        <div class="chef-detail-head">
          <h3>🍽 Order detail</h3>
          <button type="button" class="btn-close" onclick="closeChefOrderDetail()">✖</button>
        </div>
        <div id="chefDetailContent" class="chef-detail-content"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }
}

ensureDynamicLayout();
ensureChefEnhancementLayout();

const chefFilterEl = document.getElementById("chefFilter");
const categoryFilterEl = document.getElementById("categoryFilter");
const subFilterEl = document.getElementById("subFilter");
const langSelect = document.getElementById("langSelect");
const activeBox = document.getElementById("chefOrders");
const readyBox = document.getElementById("readyOrders");
const chefStatsBox = document.getElementById("chefStatsBox");
const newOrdersBadge = document.getElementById("newOrdersBadge");
const myActiveCountEl = document.getElementById("myActiveCount");
const allChefsStatsEl = document.getElementById("allChefsStats");
const statsPanelEl = document.getElementById("statsPanel");
const chefChatRoomsDom = document.getElementById("chefChatRooms");
const chefChatMessagesDom = document.getElementById("chefChatMessages");
const chefChatInputDom = document.getElementById("chefChatInput");
const chefChatSendBtnDom = document.getElementById("chefChatSendBtn");
const chefChatTitleDom = document.getElementById("chefChatTitle");
const tableStatusBoardDom = document.getElementById("tableStatusBoard");

/* =========================
   I18N
========================= */
function t(key) {
  return window.LANGS?.[currentLang]?.[key] || key;
}

/* =========================
   HELPERS
========================= */
function playSound() {
  const audio = new Audio("/img/notify.wav?v=2");
  audio.preload = "auto";
  audio.play().catch(err => {
    console.warn("notify.wav ijro bo'lmadi:", err);
  });
}

const STATUS_LABELS = {
  new: "new",
  approved: "approved",
  cooking: "cooking",
  ready: "ready",
  closed: "closed"
};

function getAssignedChefId(orderId, order = null) {
  const orderChefId = String(order?.chefId || "").trim();
  if (orderChefId) return orderChefId;
  const chatChefId = String(
    window.orderChatsByOrder?.[orderId]?.meta?.targetId || ""
  ).trim();
  if (chatChefId) return chatChefId;
  return "";
}

function getAssignedChefName(orderId, order = null) {
  const chefId = String(getAssignedChefId(orderId, order) || "");
  if (!chefId) return "—";
  return window.allChefs?.[chefId]?.name || chefId;
}

function getSelectedChef() {
  return chefFilterEl?.value || localStorage.getItem("chefFilter") || "all";
}

function getSelectedCategory() {
  return categoryFilterEl?.value || localStorage.getItem("categoryFilter") || "all";
}

function getSelectedSub() {
  return subFilterEl?.value || localStorage.getItem("subFilter") || "all";
}

function getLocale() {
  if (currentLang === "ru") return "ru-RU";
  if (currentLang === "en") return "en-GB";
  return "uz-UZ";
}

function escapeChatHTML(str = "") {
  return String(str).replace(/[&<>"']/g, s => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[s]));
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch] || ch));
}

function escapeJsString(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function formatClock(ts) {
  if (!ts) return "--:--";
  return new Date(ts).toLocaleTimeString(getLocale(), {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatOrderTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString(getLocale(), {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(getLocale(), {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });
}

function formatDuration(ms) {
  const totalMs = Number(ms || 0);
  if (!totalMs || totalMs < 0) return `0 ${t("minute_short")}`;
  const totalSec = Math.floor(totalMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h} ${t("hour_short")} ${m} ${t("minute_short")}`;
  if (m > 0) return `${m} ${t("minute_short")} ${s} ${t("second_short")}`;
  return `${s} ${t("second_short")}`;
}

function formatMoney(amount, currency = "UZS") {
  const num = Number(amount || 0);
  try {
    return new Intl.NumberFormat(getLocale(), {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "UZS" ? 0 : 2
    }).format(num);
  } catch (_) {
    return `${num.toLocaleString(getLocale())} ${currency}`;
  }
}

function isFastOrder(order) {
  return String(order?.priority || "").toLowerCase() === "fast";
}

function normalizeText(value = "") {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeKitchenStatus(status) {
  const s = normalizeText(status);
  const map = {
    yangi: "new", new: "new",
    tasdiqlandi: "approved", approved: "approved",
    tayyorlanmoqda: "cooking", cooking: "cooking",
    tayyor: "ready", ready: "ready",
    yopildi: "closed", closed: "closed"
  };
  return map[s] || "new";
}

function getOrderStatus(order) {
  return normalizeKitchenStatus(order?.status || order?.statusKey);
}

function getStatusText(status) {
  const s = normalizeKitchenStatus(status);
  const map = {
    new: "status_created",
    approved: "status_admin_approved",
    cooking: "status_cooking",
    ready: "status_ready",
    closed: "status_closed"
  };
  return t(map[s] || "status_created");
}

function getMenuName(menu, fallback = "") {
  if (!menu) return fallback;
  if (typeof menu.name === "object" && menu.name !== null) {
    return menu.name[currentLang] || menu.name.uz || menu.name.ru || menu.name.en || fallback;
  }
  if (typeof menu.name === "string") return menu.name;
  return fallback;
}

function getTranslatedItemName(item, menuItem = null, lang = currentLang || "uz") {
  if (menuItem?.name) {
    if (typeof menuItem.name === "object") {
      return menuItem.name[lang] || menuItem.name.uz || menuItem.name.ru || menuItem.name.en || "—";
    }
    return menuItem.name || "—";
  }
  if (item?.name) {
    if (typeof item.name === "object") {
      return item.name[lang] || item.name.uz || item.name.ru || item.name.en || "—";
    }
    return item.name || "—";
  }
  return "—";
}

function getOrderItemMenu(item) {
  const menuId = item.menuId || item.id || item.itemId;
  return window.allMenu?.[menuId] || null;
}

function getCategoryLabel(categoryId) {
  if (!categoryId) return "";
  const cat = CATEGORY_DATA?.categories?.find(c => c.id === categoryId);
  return cat ? (t(cat.nameKey) || categoryId) : categoryId;
}

function getSubcategoryLabel(subKey) {
  if (!subKey) return "";
  return t(subKey) || subKey;
}

function formatRemainingMs(ms) {
  if (!ms || ms <= 0) return `0 ${t("minute_short")}`;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h} ${t("hour_short")} ${m} ${t("minute_short")}`;
  return `${m} ${t("minute_short")} ${s} ${t("second_short")}`;
}

function formatRemainingTime(readyAt) {
  const diff = Number(readyAt || 0) - Date.now();
  if (diff <= 0) return `✅ ${t("ready_time_reached")}`;
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `⏳ ${minutes}:${String(seconds).padStart(2, "0")} ${t("left_short")}`;
}

function getRemainingInfo(order) {
  const readyAt = Number(order?.readyAt || 0);
  if (!readyAt) {
    return {
      text: `⏳ ${t("time_not_set")}`,
      urgent: false,
      done: false,
      delayed: false,
      delayedMinutes: 0
    };
  }
  const diff = readyAt - Date.now();
  const urgent = diff > 0 && diff <= 5 * 60 * 1000;
  const done = diff <= 0;
  const delayedMinutes = done ? Math.floor(Math.abs(diff) / 60000) : 0;
  const delayed = delayedMinutes >= 20;
  if (done) {
    return {
      text: `✅ ${t("ready_time_reached")}`,
      urgent: false,
      done: true,
      delayed,
      delayedMinutes
    };
  }
  return {
    text: `⏳ ${t("time_left_prefix")}: ${formatRemainingMs(diff)}`,
    urgent,
    done: false,
    delayed: false,
    delayedMinutes: 0
  };
}

function showNotification(text) {
  const n = document.getElementById("notification");
  if (!n) {
    console.log("Notification:", text);
    return;
  }
  n.innerText = text;
  n.classList.add("show");
  setTimeout(() => n.classList.remove("show"), 3000);
}

function showChefNotification(text) {
  showNotification(text);
}

/* =========================
   SECURITY + BOOTSTRAP
========================= */
async function ensureChefUserExists() {
  if (!currentChefId) return;
  const userRef = ref(db, "users/" + currentChefId);
  const snap = await get(userRef);
  if (snap.exists()) return;
  await set(userRef, {
    id: currentChefId,
    name: localStorage.getItem("name") || "Oshpaz",
    role: "chef",
    active: true,
    createdAt: Date.now()
  });
}

async function ensureChefAccess(requiredPermission = "kitchen_access") {
  const snap = await get(ref(db, `users/${currentChefId}`));
  if (!snap.exists()) {
    alert("User topilmadi");
    location.href = "login.html";
    throw new Error("User not found");
  }
  const user = snap.val() || {};
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  if (user.active === false) {
    alert(t("staff_inactive"));
    location.href = "login.html";
    throw new Error("Inactive chef");
  }
  const allowed =
    user.role === "admin" ||
    user.role === "chef" ||
    permissions.includes(requiredPermission) ||
    permissions.includes("kitchen_access") ||
    permissions.includes("kitchen_manage") ||
    permissions.includes("all");
  if (!allowed) {
    alert("Kitchen permission yo‘q");
    location.href = "login.html";
    throw new Error("Permission denied");
  }
  return user;
}

/* =========================
   FILTERS
========================= */
function renderCategoryFilter() {
  if (!categoryFilterEl) return;
  const savedCategory = localStorage.getItem("categoryFilter") || "all";
  categoryFilterEl.innerHTML = `<option value="all">${t("all_categories")}</option>`;
  (CATEGORY_DATA?.categories || []).forEach(cat => {
    const option = document.createElement("option");
    option.value = cat.id;
    option.textContent = t(cat.nameKey);
    categoryFilterEl.appendChild(option);
  });
  categoryFilterEl.value = savedCategory;
}

function renderSubFilter(categoryId = "all") {
  if (!subFilterEl) return;
  const savedSub = localStorage.getItem("subFilter") || "all";
  subFilterEl.innerHTML = `<option value="all">${t("all_subcategories")}</option>`;
  if (categoryId === "all") {
    subFilterEl.value = "all";
    return;
  }
  const category = CATEGORY_DATA?.categories?.find(c => c.id === categoryId);
  (category?.sub || []).forEach(subKey => {
    const option = document.createElement("option");
    option.value = subKey;
    option.textContent = t(subKey);
    subFilterEl.appendChild(option);
  });
  const exists = [...subFilterEl.options].some(opt => opt.value === savedSub);
  subFilterEl.value = exists ? savedSub : "all";
}

function fillChefFilter(users) {
  if (!chefFilterEl) return;
  const previousValue = chefFilterEl.value || localStorage.getItem("chefFilter") || "all";
  chefFilterEl.innerHTML = `<option value="all">${t("all_items")}</option>`;
  Object.entries(users).forEach(([id, user]) => {
    if (user.role !== "chef") return;
    const option = document.createElement("option");
    option.value = id;
    option.textContent = `${user.active !== false ? "🟢" : "🔴"} ${user.name || id}`;
    chefFilterEl.appendChild(option);
  });
  const exists = [...chefFilterEl.options].some(opt => opt.value === previousValue);
  chefFilterEl.value = exists ? previousValue : "all";
}

function matchesFilters(order) {
  const selectedChef = getSelectedChef();
  const selectedCategory = getSelectedCategory();
  const selectedSub = getSelectedSub();
  if (selectedChef !== "all") {
    if (String(order.chefId || "") !== String(selectedChef)) return false;
  }
  if (selectedCategory === "all" && selectedSub === "all") return true;
  const items = Object.values(order.items || {});
  return items.some(item => {
    const menu = getOrderItemMenu(item);
    if (!menu) return true;
    if (selectedCategory !== "all" && menu.category !== selectedCategory) return false;
    if (selectedSub !== "all" && menu.subcategory !== selectedSub) return false;
    return true;
  });
}

function filterChefOrdersByStatus(order) {
  const filterEl = document.getElementById("chefStatusFilter");
  const value = filterEl?.value || localStorage.getItem("chefStatusFilter") || window.chefSettings?.defaultFilter || "all";
  const status = getOrderStatus(order);
  const remaining = getRemainingInfo(order);
  if (value === "all") return true;
  if (value === "mine") return String(order?.chefId || "") === String(currentChefId);
  if (value === "delayed") return remaining.delayed;
  const normalizedStatus = normalizeKitchenStatus(status);
  const map = { new: ["new"], accepted: ["approved"], cooking: ["cooking"], ready: ["ready"] };
  return (map[value] || []).includes(normalizedStatus);
}

function filterChefOrdersByCategory(order) {
  const selectedCategory = getSelectedCategory();
  if (selectedCategory === "all") return true;
  return Object.values(order?.items || {}).some(item => {
    const menu = getOrderItemMenu(item) || {};
    return String(menu?.category || "") === String(selectedCategory);
  });
}

function filterChefOrdersByTable(order) {
  const value = normalizeText(document.getElementById("chefTableFilter")?.value || "");
  if (!value) return true;
  return normalizeText(order?.table) === value;
}

function filterChefOrdersByAssignedChef(order) {
  const selectedChef = getSelectedChef();
  if (selectedChef === "all") return true;
  return String(order?.chefId || "") === String(selectedChef);
}

function filterChefOrdersByDelay(order) {
  const value = document.getElementById("chefStatusFilter")?.value || "all";
  if (value !== "delayed") return true;
  return getRemainingInfo(order).delayed;
}

function searchChefOrders(orderId, order) {
  const query = normalizeText(document.getElementById("chefSearchInput")?.value || "");
  if (!query) return true;
  const textParts = [
    orderId, order?.table, order?.clientRequest, order?.lastClientMessage, order?.lastChefMessage,
    getAssignedChefName(orderId, order)
  ];
  Object.values(order?.items || {}).forEach(item => {
    const menu = getOrderItemMenu(item) || {};
    textParts.push(
      item?.name, getTranslatedItemName(item, menu, currentLang),
      menu?.name?.uz, menu?.name?.ru, menu?.name?.en,
      menu?.category, menu?.subcategory, item?.kitchenNote
    );
  });
  const haystack = normalizeText(textParts.filter(Boolean).join(" "));
  return haystack.includes(query);
}

function filterMyAssignedOrders(order) {
  const value = document.getElementById("chefStatusFilter")?.value || "all";
  if (value !== "mine") return true;
  return String(order?.chefId || "") === String(currentChefId);
}

function applyChefOrderFilters(orderId, order) {
  const status = getOrderStatus(order);
  const normalizedStatus = normalizeKitchenStatus(status);
  const allowed = ["new", "approved", "cooking", "ready"];
  if (!allowed.includes(normalizedStatus)) return false;
  if (!filterChefOrdersByStatus(order)) return false;
  if (!filterChefOrdersByCategory(order)) return false;
  if (!filterChefOrdersByAssignedChef(order)) return false;
  if (!filterChefOrdersByTable(order)) return false;
  if (!filterChefOrdersByDelay(order)) return false;
  if (!filterMyAssignedOrders(order)) return false;
  if (!searchChefOrders(orderId, order)) return false;
  return true;
}

function getOrderPriorityLabel(order) {
  const remaining = getRemainingInfo(order);
  if (remaining.delayed) return "critical";
  if (remaining.urgent) return "high";
  if (isFastOrder(order)) return "fast";
  if (String(order?.deliveryType || order?.orderType || "").toLowerCase().includes("delivery")) return "delivery";
  if (String(order?.reservationId || order?.isReservation || "")) return "reservation";
  if (String(order?.customerType || order?.loyalty || "").toLowerCase().includes("vip")) return "vip";
  return "normal";
}

function sortChefOrdersByPriority(entries = []) {
  const statusRank = { queue: 0, yangi: 1, tasdiqlandi: 2, tayyorlanmoqda: 3, tayyor: 4 };
  const priorityRank = { critical: 0, high: 1, fast: 2, delivery: 3, reservation: 4, vip: 5, normal: 6 };
  return [...entries].sort((a, b) => {
    const [idA, orderA] = a;
    const [idB, orderB] = b;
    const pA = priorityRank[getOrderPriorityLabel(orderA)] ?? 999;
    const pB = priorityRank[getOrderPriorityLabel(orderB)] ?? 999;
    if (pA !== pB) return pA - pB;
    const sA = statusRank[getOrderStatus(orderA)] ?? 999;
    const sB = statusRank[getOrderStatus(orderB)] ?? 999;
    if (sA !== sB) return sA - sB;
    const tA = Number(orderA?.createdAt || 0);
    const tB = Number(orderB?.createdAt || 0);
    return tA - tB;
  });
}

function getChefVisibleOrders() {
  const entries = Object.entries(allOrders || {}).filter(([orderId, order]) => applyChefOrderFilters(orderId, order));
  return sortChefOrdersByPriority(entries);
}

/* =========================
   RENDER ORDERS (ENHANCED)
========================= */
function getOrderCookStartTime(order) {
  return Number(order?.startedAt || order?.takenAt || order?.assignedAt || order?.createdAt || 0);
}

function getOrderWaitDuration(order) {
  const start = getOrderCookStartTime(order);
  if (!start) return 0;
  const end = Number(order?.finishedAt || Date.now());
  return Math.max(0, end - start);
}

function getPriorityBadgeHtml(order) {
  const p = getOrderPriorityLabel(order);
  const map = {
    critical: `<span class="priority-badge critical">🚨 Critical</span>`,
    high: `<span class="priority-badge high">⏰ High</span>`,
    fast: `<span class="priority-badge fast">⚡ Fast</span>`,
    delivery: `<span class="priority-badge delivery">🛵 Delivery</span>`,
    reservation: `<span class="priority-badge reservation">📅 Reservation</span>`,
    vip: `<span class="priority-badge vip">👑 VIP</span>`,
    normal: `<span class="priority-badge normal">🟢 Normal</span>`
  };
  return map[p] || map.normal;
}

function getItemKitchenState(item = {}) {
  return normalizeText(item?.kitchenStatus || item?.status || "");
}

function getItemKitchenBadge(item = {}) {
  const state = getItemKitchenState(item);
  if (state === "prepared") return `<span class="item-kitchen-badge prepared">✅ Prepared</span>`;
  if (state === "delayed") return `<span class="item-kitchen-badge delayed">⏰ Delayed</span>`;
  if (state === "rejected") return `<span class="item-kitchen-badge rejected">❌ Rejected</span>`;
  return `<span class="item-kitchen-badge pending">🕓 Pending</span>`;
}

function renderOrderItemsDetailed(orderId, order) {
  const items = Object.entries(order?.items || {});
  if (!items.length) return `<div class="detail-empty">Item yo'q</div>`;
  return items.map(([itemKey, item]) => {
    const menu = getOrderItemMenu(item) || {};
    const name = getTranslatedItemName(item, menu, currentLang);
    const qty = Number(item?.qty || 1);
    const note = item?.kitchenNote ? `<div class="item-kitchen-note">📝 ${escapeHtml(item.kitchenNote)}</div>` : "";
    const prepTime = Number(item?.prepTime || menu?.prepTime || 15);
    return `
      <div class="chef-item-row">
        <div class="chef-item-main">
          <div class="chef-item-title">
            <b>${escapeHtml(name)}</b>
            <span>x${qty}</span>
            ${getItemKitchenBadge(item)}
          </div>
          <div class="chef-item-meta">
            ${escapeHtml(getCategoryLabel(menu?.category))}${menu?.subcategory ? ` • ${escapeHtml(getSubcategoryLabel(menu.subcategory))}` : ""}
            • ${prepTime} ${t("minute_short")}
          </div>
          ${note}
        </div>
        <div class="chef-item-actions">
          <button type="button" onclick="toggleItemPrepared('${escapeJsString(orderId)}','${escapeJsString(itemKey)}')">✅</button>
          <button type="button" onclick="markDelayedItem('${escapeJsString(orderId)}','${escapeJsString(itemKey)}')">⏰</button>
          <button type="button" onclick="addKitchenNote('${escapeJsString(orderId)}','${escapeJsString(itemKey)}')">📝</button>
          <button type="button" onclick="rejectOrderItem('${escapeJsString(orderId)}','${escapeJsString(itemKey)}')">❌</button>
          <button type="button" onclick="toggleItemAvailability('${escapeJsString(menu?.id || item?.menuId || itemKey)}', false)">⛔</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderChefOrderCard(orderId, order, queueNumber, container) {
  const card = document.createElement("div");
  card.className = "order-card chef-order-card";
  card.dataset.orderId = String(orderId);
  if (order.readyAt) card.dataset.readyAt = String(order.readyAt);

  const currentStatus = getOrderStatus(order);
  const statusKey = normalizeKitchenStatus(currentStatus);
  const chef = order.chefId ? window.allChefs?.[order.chefId] : null;
  const isMyOrder = getAssignedChefId(orderId, order) === String(currentChefId);
  const canChangeStatus = isMyOrder;
  const fast = isFastOrder(order);
  const remaining = getRemainingInfo(order);
  const tableStatus = getTableStatusLabel(deriveTableStatusFromOrders(order.table));
  const waitDuration = getOrderWaitDuration(order);

  card.classList.add("order-normal");
  if (fast) card.classList.add("order-fast");
  if (remaining.urgent) card.classList.add("urgent-ready");
  if (remaining.done) card.classList.add("time-done");
  if (remaining.delayed) card.classList.add("order-delayed");

  card.innerHTML = `
    <div class="chef-order-top">
      <div class="chef-order-left">
        <span class="queue-badge">#${queueNumber}</span>
        <span class="table-badge">🪑 ${t("table_label")} ${order.table ?? "-"}</span>
        <span class="table-state-badge">${escapeHtml(tableStatus)}</span>
        ${fast ? `<span class="fast-badge">⚡ ${t("fast_order_badge")}</span>` : `<span class="normal-badge">🟢 ${t("normal_order_badge")}</span>`}
        ${getPriorityBadgeHtml(order)}
      </div>
      <div class="chef-order-right">
        <span class="status status-${statusKey}">${getStatusText(currentStatus)}</span>
      </div>
    </div>
    <div class="chef-order-timer">
      <div>${remaining.text || formatRemainingTime(order.readyAt)}</div>
      <small>⏱ Ish vaqti: ${formatDuration(waitDuration)}</small>
    </div>
    <div class="order-urgency-line">${remaining.delayed ? `🚨 ${t("delayed_order")} • ${remaining.delayedMinutes} ${t("minute_short")}` : remaining.urgent ? `🚨 ${t("urgent_order")}` : remaining.done ? `✅ ${t("ready_time_reached")}` : ""}</div>
  `;

  if (chef) {
    const chefDiv = document.createElement("div");
    chefDiv.className = "order-chef-info";
    chefDiv.innerHTML = `<span class="chef-name ${isMyOrder ? "my-chef" : ""}">${isMyOrder ? "👨‍🍳" : "🧑‍🍳"} ${chef.name || order.chefId}</span>`;
    card.appendChild(chefDiv);
  }

  const itemsDiv = document.createElement("div");
  itemsDiv.className = "order-items";
  Object.values(order.items || {}).forEach(item => {
    const menu = getOrderItemMenu(item) || {};
    const name = getTranslatedItemName(item, menu, currentLang);
    let img = menu.imgUrl || menu.img || menu.image || item.img || "/img/no-image.png";
    if (!img || img === "undefined" || img === "null") img = "/img/no-image.png";
    const category = getCategoryLabel(menu.category);
    const sub = getSubcategoryLabel(menu.subcategory);
    const itemEl = document.createElement("div");
    itemEl.className = "order-item";
    itemEl.innerHTML = `
      <img src="${img}" class="item-img" alt="${escapeHtml(name)}">
      <div class="item-info">
        <div class="item-name">${escapeHtml(name)}</div>
        <div class="item-cat">${escapeHtml(category)}${sub ? " • " + escapeHtml(sub) : ""}</div>
        <div class="item-qty">x ${item.qty || 1}</div>
      </div>
    `;
    const imgEl = itemEl.querySelector("img");
    if (imgEl) imgEl.onerror = function () { this.onerror = null; this.src = "/img/no-image.png"; };
    itemsDiv.appendChild(itemEl);
  });
  card.appendChild(itemsDiv);

  if (order.clientRequest) {
    const requestBox = document.createElement("div");
    requestBox.className = "client-request-box";
    requestBox.innerHTML = `<div class="client-request-title">📝 ${t("client_request_title")}</div><div class="client-request-text">${escapeHtml(order.clientRequest)}</div>`;
    card.appendChild(requestBox);
  }

  const chatRoom = window.orderChatsByOrder?.[orderId];
  const allChatMessages = chatRoom?.messages || [];
  const lastThreeMessages = allChatMessages.slice(-3);
  if (!allChatMessages.length && order.lastClientMessage) {
    const lastMsgBox = document.createElement("div");
    lastMsgBox.className = "client-request-box";
    lastMsgBox.innerHTML = `<div class="client-request-title">💬 ${t("last_message_title")}</div><div class="client-request-text">${escapeHtml(order.lastClientMessage)}</div>`;
    card.appendChild(lastMsgBox);
  }

  if (isMyOrder || getSelectedChef() === "all" || lastThreeMessages.length) {
    const chatBox = document.createElement("div");
    chatBox.className = "order-chat-box";
    chatBox.innerHTML = `
      <div class="order-chat-head">💬 ${t("order_chat_title")} — ${t("table_label")} ${order.table || "-"}</div>
      <div class="order-chat-messages">
        ${lastThreeMessages.length ? lastThreeMessages.map(msg => `<div class="order-chat-message ${msg.senderRole === "chef" ? "chef" : "client"}"><div>${escapeHtml(msg.text || "")}</div><div class="order-chat-meta">${escapeHtml(msg.senderName || "")} • ${formatOrderTime(msg.createdAt)}</div></div>`).join("") : `<div class="client-chat-empty">${t("no_messages_yet")}</div>`}
      </div>
      ${isMyOrder ? `<div class="order-chat-reply"><input id="chefReplyInput_${orderId}" type="text" placeholder="${t("reply_to_client_placeholder")}" /><button type="button" onclick="sendChefInlineReply('${orderId}')">${t("send_message")}</button></div>` : ""}
    `;
    card.appendChild(chatBox);
  }

  const statusActions = document.createElement("div");
  statusActions.className = "order-status-actions";

  if (!order.chefId && ["queue", "new"].includes(normalizeKitchenStatus(currentStatus))) {
    const takeBtn = document.createElement("button");
    takeBtn.type = "button";
    takeBtn.className = "btn-status btn-status-approved";
    takeBtn.textContent = `👨‍🍳 ${t("take_order_btn")}`;
    takeBtn.addEventListener("click", () => window.takeOrder(orderId));
    statusActions.appendChild(takeBtn);
  }

  const statusButtons = [
    { status: "approved", label: `✅ ${t("status_admin_approved")}`, className: "btn-status-approved" },
    { status: "cooking", label: `🔥 ${t("status_cooking")}`, className: "btn-status-cooking" },
    { status: "ready", label: `🍽️ ${t("status_ready")}`, className: "btn-status-ready" }
  ];

  statusButtons.forEach(btn => {
    const button = document.createElement("button");
    button.className = `btn-status ${btn.className} ${currentStatus === btn.status ? "active" : ""}`;
    button.textContent = btn.label;
    button.type = "button";
    if (currentStatus === btn.status) button.disabled = true;
    if (!canChangeStatus && order.chefId) {
      button.disabled = true;
      button.style.opacity = "0.5";
      button.title = t("not_your_order");
    }
    button.addEventListener("click", async e => {
      e.preventDefault();
      e.stopPropagation();
      if (!canChangeStatus) { alert(`❌ ${t("not_your_order")}`); return; }
      await window.changeOrderStatus(orderId, btn.status);
    });
    statusActions.appendChild(button);
  });

  card.appendChild(statusActions);

  const footer = document.createElement("div");
  footer.className = "chef-order-footer";
  footer.innerHTML = `<span>🕐 ${t("dropped_at_label")}: ${formatClock(order.createdAt)}</span><span>🍽 ${t("ready_by_label")}: ${formatClock(order.readyAt)}</span>`;
  card.appendChild(footer);

  container.appendChild(card);
}

function renderChefOrders() {
  try {
    if (!activeBox || !readyBox) return;
  } catch (err) {
    console.error("renderChefOrders error:", err);
  }
  const entries = getChefVisibleOrders();
  let hash = 5381;
  for (const [orderId, order] of entries) {
    const chatCount = (window.orderChatsByOrder?.[orderId]?.messages || []).length;
    const str = `${orderId}:${order.status}:${order.statusKey}:${order.updatedAt}:${order.readyAt}:${order.chefId}:${getAssignedChefId(orderId, order)}:${chatCount}`;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
  }
  const newSignature = String(hash >>> 0);
  if (newSignature === lastOrdersSignature) {
    updateOrderCountdowns();
    return;
  }
  lastOrdersSignature = newSignature;
  activeBox.innerHTML = "";
  readyBox.innerHTML = "";
  let activeIndex = 0, readyIndex = 0;
  entries.forEach(([orderId, order]) => {
    const status = getOrderStatus(order);
    if (["new", "approved", "cooking"].includes(status)) {
      activeIndex += 1;
      renderChefOrderCard(orderId, order, activeIndex, activeBox);
    } else if (status === "ready") {
      readyIndex += 1;
      renderChefOrderCard(orderId, order, readyIndex, readyBox);
    }
  });
  updateOrderCountdowns();
}

/* =========================
   ORDER STATUS ACTIONS
========================= */
async function createKitchenTimelineEvent(orderId, eventType, payload = {}) {
  if (!orderId || !eventType) return null;
  const actorName = window.allChefs?.[currentChefId]?.name || localStorage.getItem("name") || "Chef";
  const actorRole = "chef";
  const eventRef = push(ref(db, `orderTimeline/${orderId}`));
  await set(eventRef, { orderId, eventType, payload, actorId: currentChefId, actorName, actorRole, createdAt: Date.now() });
  await update(ref(db, `orders/${orderId}`), { lastTimelineEventAt: Date.now(), lastTimelineEventType: eventType });
  return eventRef.key;
}

async function kitchenAudit(action, payload = {}, severity = "info") {
  const actorName = window.allChefs?.[currentChefId]?.name || localStorage.getItem("name") || "Chef";
  await push(ref(db, "activityLogs"), {
    userId: currentChefId, userName: actorName, userRole: "chef", module: "kitchen",
    action, target: String(payload.orderId || payload.productId || payload.itemId || ""),
    severity, description: action, payload, createdAt: Date.now()
  });
}

async function updateOrderKitchenStatus(orderId, nextStatus, extra = {}) {
  await ensureChefAccess("kitchen_manage");
  const snap = await get(ref(db, `orders/${orderId}`));
  if (!snap.exists()) return;
  const order = snap.val();
  const normalized = normalizeKitchenStatus(nextStatus);
  const now = Date.now();
  const current = getOrderStatus(order);
  const patches = { status: normalized, statusKey: normalized, statusLabel: normalized, updatedAt: now, updatedBy: currentChefId, ...extra };
  if (!order.chefId && ["approved", "cooking", "ready"].includes(normalized)) {
    patches.chefId = currentChefId;
    patches.assignedAt = now;
  }
  if (normalized === "approved" && !order.takenAt) patches.takenAt = now;
  if (normalized === "cooking" && !order.startedAt) patches.startedAt = now;
  if (normalized === "ready") patches.finishedAt = now;
  if (normalized === "cooking" && current === "ready") patches.finishedAt = null;
  if (normalized === "closed") patches.closedAt = now;
  await update(ref(db, `orders/${orderId}`), patches);
  if (order?.table) {
    await writeTableState(order.table, {
      status: normalized === "ready" ? "ready" : normalized === "closed" ? "free" : "open",
      orderId: normalized === "closed" ? null : orderId,
      chefId: patches.chefId || order.chefId || currentChefId,
      kitchenStatus: normalized
    });
  }
  await createKitchenTimelineEvent(orderId, "order_status_changed", { from: current, to: normalized, assignedBy: extra.assignedBy || null, assignedAt: patches.assignedAt || null });
  await kitchenAudit("order_status_changed", { orderId, from: current, to: normalized, table: order.table || null });
  if (normalized === "ready" && order?.table) {
    await push(ref(db, "waiterCalls"), {
      table: order.table, orderId, message: `🪑 ${t("table_label")} ${order.table}: ${t("status_ready")}`,
      createdAt: now, status: "waiting", chefId: currentChefId, chefName: window.allChefs?.[currentChefId]?.name || currentChefId
    });
  }
  showChefNotification(`✅ Status: ${normalized}`);
}

window.changeOrderStatus = async function (orderId, status) {
  await updateOrderKitchenStatus(orderId, status);
};

window.acceptOrder = async function (orderId) {
  await updateOrderKitchenStatus(orderId, "approved");
};

window.startCooking = async function (orderId) {
  await updateOrderKitchenStatus(orderId, "cooking");
};

window.markOrderReady = async function (orderId) {
  await updateOrderKitchenStatus(orderId, "ready");
};

window.returnOrderToCooking = async function (orderId) {
  await updateOrderKitchenStatus(orderId, "cooking", { returnedToCookingAt: Date.now() });
};

window.reopenReadyOrder = async function (orderId) {
  await updateOrderKitchenStatus(orderId, "cooking", { reopenedAt: Date.now() });
};

window.takeOrder = async function (orderId) {
  const snap = await get(ref(db, "orders/" + orderId));
  if (!snap.exists()) return;
  const order = snap.val();
  if (order.chefId) { alert(t("order_already_taken")); return; }
  const now = Date.now();
  await update(ref(db, "orders/" + orderId), {
    chefId: currentChefId, status: "approved", statusKey: "approved", statusLabel: "approved",
    takenAt: now, updatedAt: now, assignedAt: now
  });
  if (order.table) await writeTableState(order.table, { status: "open", orderId, chefId: currentChefId, kitchenStatus: "approved" });
  emitSocket("chef:new-order", { orderId, orderNumber: order.orderNumber || orderId, chefId: currentChefId, table: order.table || null });
  showNotification(t("order_taken"));
};

window.claimOrder = window.takeOrder;

window.sendChefInlineReply = async function (orderId) {
  const input = document.getElementById(`chefReplyInput_${orderId}`);
  const text = input?.value.trim();
  if (!text) return;
  const myChefId = String(currentChefId || "").trim();
  if (!myChefId) return;
  const orderSnap = await get(ref(db, "orders/" + orderId));
  if (!orderSnap.exists()) return;
  const order = orderSnap.val();
  const orderChefId = String(order.chefId || "").trim();
  if (orderChefId !== myChefId) { alert(t("not_your_order")); return; }
  const senderName = window.allChefs?.[myChefId]?.name || t("chef_label");
  const now = Date.now();
  await update(ref(db, `orderChats/${orderId}/chef/meta`), {
    orderId, orderNumber: order.orderNumber || null, table: order.table || null,
    clientId: order.clientId || null, targetId: myChefId, targetRole: "chef",
    chefName: senderName, lastMessage: text, lastSenderRole: "chef", updatedAt: now, status: "open"
  });
  await push(ref(db, `orderChats/${orderId}/chef/messages`), {
    text, senderId: myChefId, senderRole: "chef", senderName, orderId, table: order.table || null, createdAt: now
  });
  await update(ref(db, `orders/${orderId}`), { lastChefMessage: text, lastChefMessageAt: now });
  emitSocket("chef:chat-message", { orderId, text, senderId: myChefId, senderName, createdAt: now });
  input.value = "";
};

/* =========================
   ITEM-LEVEL ACTIONS
========================= */
function resolveOrderItemKey(order, itemId) {
  if (!order?.items) return "";
  if (order.items[itemId]) return itemId;
  const found = Object.entries(order.items).find(([key, item]) => String(item?.menuId || item?.id || item?.itemId || key) === String(itemId));
  return found?.[0] || "";
}

async function updateOrderItemStatus(orderId, itemId, patch = {}) {
  const snap = await get(ref(db, `orders/${orderId}`));
  if (!snap.exists()) return "";
  const order = snap.val();
  const resolvedKey = resolveOrderItemKey(order, itemId);
  if (!resolvedKey) return "";
  await update(ref(db, `orders/${orderId}/items/${resolvedKey}`), { ...patch, updatedAt: Date.now(), updatedBy: currentChefId });
  return resolvedKey;
}

window.toggleItemPrepared = async function (orderId, itemId) {
  const snap = await get(ref(db, `orders/${orderId}`));
  if (!snap.exists()) return;
  const order = snap.val();
  const resolvedKey = resolveOrderItemKey(order, itemId);
  if (!resolvedKey) return;
  const currentItem = order?.items?.[resolvedKey] || {};
  const nextState = getItemKitchenState(currentItem) === "prepared" ? "pending" : "prepared";
  await updateOrderItemStatus(orderId, resolvedKey, { kitchenStatus: nextState, preparedAt: nextState === "prepared" ? Date.now() : null });
  await createKitchenTimelineEvent(orderId, "item_toggled_prepared", { itemId: resolvedKey, kitchenStatus: nextState });
  await kitchenAudit("item_toggled_prepared", { orderId, itemId: resolvedKey, kitchenStatus: nextState });
  renderChefOrders();
};

window.markDelayedItem = async function (orderId, itemId) {
  await updateOrderItemStatus(orderId, itemId, { kitchenStatus: "delayed", delayedAt: Date.now() });
  await createKitchenTimelineEvent(orderId, "item_delayed", { itemId });
  await kitchenAudit("item_delayed", { orderId, itemId });
  renderChefOrders();
};

window.addKitchenNote = async function (orderId, itemId, note) {
  const finalNote = typeof note === "string" ? note : prompt("Kitchen note kiriting:");
  if (!finalNote) return;
  const resolvedKey = await updateOrderItemStatus(orderId, itemId, { kitchenNote: finalNote });
  await createKitchenTimelineEvent(orderId, "item_note_added", { itemId: resolvedKey || itemId, note: finalNote });
  await kitchenAudit("item_note_added", { orderId, itemId: resolvedKey || itemId, note: finalNote });
  renderChefOrders();
};

window.rejectOrderItem = async function (orderId, itemId, reason = "Rejected") {
  const finalReason = reason || prompt("Sabab kiriting:") || "Rejected";
  const resolvedKey = await updateOrderItemStatus(orderId, itemId, { kitchenStatus: "rejected", rejectedReason: finalReason, rejectedAt: Date.now() });
  await createKitchenTimelineEvent(orderId, "item_rejected", { itemId: resolvedKey || itemId, reason: finalReason });
  await kitchenAudit("item_rejected", { orderId, itemId: resolvedKey || itemId, reason: finalReason });
  renderChefOrders();
};

window.markAllItemsPrepared = async function (orderId) {
  const snap = await get(ref(db, `orders/${orderId}`));
  if (!snap.exists()) return;
  const order = snap.val();
  const ops = Object.keys(order?.items || {}).map(key => update(ref(db, `orders/${orderId}/items/${key}`), { kitchenStatus: "prepared", preparedAt: Date.now(), updatedAt: Date.now(), updatedBy: currentChefId }));
  await Promise.all(ops);
  await createKitchenTimelineEvent(orderId, "all_items_prepared", {});
  await kitchenAudit("all_items_prepared", { orderId });
  renderChefOrders();
};

/* =========================
   STOP-LIST
========================= */
function renderStopList() {
  const root = document.getElementById("stopListBoard");
  if (!root) return;
  const items = Object.entries(window.stopList || {}).filter(([_, item]) => item?.active !== false).sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0));
  root.innerHTML = `<div class="chef-widget-head">⛔ Stop-list</div><div class="chef-widget-body">${items.length ? items.map(([id, item]) => `<div class="stop-row"><div><b>${escapeHtml(item?.name || id)}</b><small>${formatDateTime(item?.updatedAt || item?.createdAt)}</small></div><button type="button" onclick="removeFromStopList('${escapeJsString(id)}')">♻️</button></div>`).join("") : `<div class="detail-empty">Stop-list bo'sh</div>`}</div>`;
}

async function loadStopList() {
  const snap = await get(ref(db, "stopList"));
  window.stopList = snap.val() || {};
  renderStopList();
  return window.stopList;
}



window.addToStopList = async function (productId, productName) {
  await ensureChefAccess("kitchen_manage");
  await update(ref(db, `stopList/${productId}`), { productId, name: productName, active: true, createdAt: Date.now(), updatedAt: Date.now(), updatedBy: currentChefId, addedAt: Date.now(), addedBy: currentChefId, source: "chef" });
  await update(ref(db, `menu/${productId}`), { active: false, outAt: Date.now(), outBy: currentChefId });
  await kitchenAudit("stop_list_added", { productId, name: productName }, "warning");
};

window.removeFromStopList = async function (productId) {
  await remove(ref(db, `stopList/${productId}`));
  await update(ref(db, `menu/${productId}`), { active: true, backAt: Date.now(), backBy: currentChefId });
  await kitchenAudit("stop_list_removed", { productId }, "info");
};

window.toggleItemAvailability = async function (productId, active) {
  await update(ref(db, `menu/${productId}`), { active: !!active, updatedAt: Date.now(), updatedBy: currentChefId });
  if (active) await window.removeFromStopList(productId);
  else { const name = window.allMenu?.[productId]?.name?.[currentLang] || window.allMenu?.[productId]?.name || productId; await window.addToStopList(productId, name); }
};

/* =========================
   KITCHEN NOTIFICATIONS
========================= */
function buildKitchenNotifications() {
  const list = [];
  const entries = getChefVisibleOrders();
  entries.forEach(([orderId, order]) => {
    const remaining = getRemainingInfo(order);
    const isMine = String(getAssignedChefId(orderId, order)) === String(currentChefId);
    if (isMine && ["new", "approved"].includes(getOrderStatus(order))) list.push({ id: `new_${orderId}`, type: "new_order", createdAt: Number(order?.createdAt || Date.now()), text: `🆕 Yangi order #${orderId}` });
    if (remaining.delayed) list.push({ id: `delay_${orderId}`, type: "delay", createdAt: Date.now(), text: `🚨 Kechikkan order #${orderId}` });
    if (order?.clientRequest) list.push({ id: `note_${orderId}`, type: "note", createdAt: Number(order?.updatedAt || order?.createdAt || Date.now()), text: `📝 Note mavjud: #${orderId}` });
    const stopHits = Object.values(order?.items || {}).filter(item => { const menuId = item?.menuId || item?.id || item?.itemId; return menuId && window.stopList?.[menuId]?.active !== false; });
    if (stopHits.length) list.push({ id: `stop_${orderId}`, type: "stoplist", createdAt: Date.now(), text: `⛔ Stop-list item order #${orderId}` });
  });
  Object.entries(window.stopList || {}).forEach(([productId, item]) => { if (item?.active !== false) list.push({ id: `stopitem_${productId}`, type: "stop_item", createdAt: Number(item?.updatedAt || item?.createdAt || Date.now()), text: `⛔ Stop-list: ${item?.name || productId}` }); });
  return list.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 20);
}

function loadKitchenNotifications() {
  window.kitchenNotifications = buildKitchenNotifications();
  renderKitchenNotifications();
  return window.kitchenNotifications;
}

function renderKitchenNotifications() {
  const root = document.getElementById("kitchenNotificationsPanel");
  if (!root) return;
  const readIds = new Set(getKitchenReadNotifications());
  const items = window.kitchenNotifications || [];
  root.innerHTML = `<div class="chef-widget-head">🔔 Kitchen notifications</div><div class="chef-widget-body">${items.length ? items.map(item => `<div class="kitchen-note-row ${readIds.has(item.id) ? "is-read" : ""}"><div>${escapeHtml(item.text)}</div><div class="kitchen-note-actions"><small>${formatDateTime(item.createdAt)}</small><button type="button" onclick="markKitchenNotificationRead('${escapeJsString(item.id)}')">✓</button></div></div>`).join("") : `<div class="detail-empty">Notification yo'q</div>`}</div>`;
}

function getKitchenReadNotifications() {
  try { return JSON.parse(localStorage.getItem("kitchenReadNotifications") || "[]"); } catch (_) { return []; }
}
function setKitchenReadNotifications(ids) { localStorage.setItem("kitchenReadNotifications", JSON.stringify(ids || [])); }
window.markKitchenNotificationRead = function (id) { const ids = new Set(getKitchenReadNotifications()); ids.add(id); setKitchenReadNotifications([...ids]); renderKitchenNotifications(); };

/* =========================
   STATS
========================= */
function calculateAllStats() {
  const stats = {};
  Object.keys(window.allChefs || {}).forEach(chefId => { stats[chefId] = { active: 0, fast: 0, normal: 0, ready: 0, total: 0, totalWorkMinutes: 0, delayed: 0, loadPercent: 0 }; });
  Object.values(allOrders || {}).forEach(order => {
    const chefId = String(order.chefId || "").trim();
    if (!chefId) return;
    if (!stats[chefId]) stats[chefId] = { active: 0, fast: 0, normal: 0, ready: 0, total: 0, totalWorkMinutes: 0, delayed: 0, loadPercent: 0 };
    const s = stats[chefId];
    const status = getOrderStatus(order);
    const isFast = isFastOrder(order);
    const remaining = getRemainingInfo(order);
    s.total += 1;
    if (isFast) s.fast += 1; else s.normal += 1;
    const normalizedStatus = normalizeKitchenStatus(status);
    if (["new", "approved", "cooking"].includes(normalizedStatus)) s.active += 1;
    if (normalizedStatus === "ready") s.ready += 1;
    if (remaining.delayed) s.delayed += 1;
    const startTime = Number(order.takenAt || order.startedAt || 0);
    const endTime = Number(order.finishedAt || order.updatedAt || 0);
    if (startTime && endTime && endTime > startTime) s.totalWorkMinutes += Math.round((endTime - startTime) / 60000);
  });
  const maxActive = Math.max(1, ...Object.values(stats).map(item => item.active || 0));
  Object.values(stats).forEach(item => { item.loadPercent = Math.min(100, Math.round(((item.active || 0) / maxActive) * 100)); });
  return stats;
}

function updateStatistics() {
  const allStats = calculateAllStats();
  const myStats = allStats[currentChefId] || { active: 0, fast: 0, normal: 0, ready: 0, total: 0, totalWorkMinutes: 0 };
  if (myActiveCountEl) { myActiveCountEl.textContent = myStats.active; myActiveCountEl.style.display = myStats.active > 0 ? "inline-flex" : "none"; }
  const statMyActiveEl = document.getElementById("statMyActive"), statMyFastEl = document.getElementById("statMyFast"), statMyNormalEl = document.getElementById("statMyNormal"), statMyReadyEl = document.getElementById("statMyReady"), statMyWorkTimeEl = document.getElementById("statMyWorkTime"), statMyTotalEl = document.getElementById("statMyTotal");
  if (statMyActiveEl) statMyActiveEl.textContent = myStats.active;
  if (statMyFastEl) statMyFastEl.textContent = myStats.fast;
  if (statMyNormalEl) statMyNormalEl.textContent = myStats.normal;
  if (statMyReadyEl) statMyReadyEl.textContent = myStats.ready;
  if (statMyWorkTimeEl) statMyWorkTimeEl.textContent = `${myStats.totalWorkMinutes} ${t("minute_short")}`;
  if (statMyTotalEl) statMyTotalEl.textContent = myStats.total;
  renderKitchenLoadSummary(allStats);
  renderAllChefsStats(allStats);
}

function renderKitchenLoadSummary(allStats) {
  if (!chefStatsBox) return;
  const rows = Object.entries(allStats).sort((a, b) => b[1].active - a[1].active).map(([chefId, stat]) => { const chef = window.allChefs?.[chefId]; if (!chef) return ""; const me = chefId === currentChefId ? " me" : ""; return `<div class="chef-load-row${me}"><div class="chef-load-name">${chef.name || chefId}</div><div class="chef-load-meta">${stat.active} ${t("active_now")}</div><div class="chef-load-bar"><span style="width:${stat.loadPercent}%"></span></div></div>`; }).join("");
  chefStatsBox.innerHTML = `<div class="chef-load-box"><div class="chef-load-title">📊 ${t("kitchen_load_title")}</div>${rows || `<div class="chef-load-empty">—</div>`}</div>`;
}

function renderAllChefsStats(allStats) {
  if (!allChefsStatsEl) return;
  const sortedChefs = Object.entries(allStats).sort((a, b) => { if (b[1].active !== a[1].active) return b[1].active - a[1].active; if (b[1].ready !== a[1].ready) return b[1].ready - a[1].ready; return b[1].totalWorkMinutes - a[1].totalWorkMinutes; });
  allChefsStatsEl.innerHTML = `<h4>${t("all_chefs_title")}</h4><div class="stats-legend"><div class="legend-item">${t("stats_active_short")}</div><div class="legend-item">${t("stats_fast_short")}</div><div class="legend-item">${t("stats_normal_short")}</div><div class="legend-item">${t("stats_ready_short")}</div><div class="legend-item">${t("stats_time_short")}</div></div>${sortedChefs.map(([chefId, stats]) => { const chef = window.allChefs?.[chefId]; if (!chef) return ""; const isMe = chefId === currentChefId; const isActive = chef.active !== false; return `<div class="chef-stat-row ${isMe ? "my-row" : ""} ${!isActive ? "inactive" : ""}"><div class="chef-stat-name">${isMe ? "👨‍🍳" : "🧑‍🍳"} ${chef.name || chefId}${isMe ? `<span class="me-badge">${t("me_badge")}</span>` : ""}${!isActive ? `<span class="inactive-badge">${t("inactive_badge")}</span>` : ""}</div><div class="chef-stat-numbers"><span class="stat-badge active-badge">🔥 ${stats.active}</span><span class="stat-badge fast-badge">⚡ ${stats.fast}</span><span class="stat-badge normal-badge">🟢 ${stats.normal}</span><span class="stat-badge completed-badge">✅ ${stats.ready}</span><span class="stat-badge time-badge">⏱ ${stats.totalWorkMinutes} ${t("minute_short")}</span></div></div>`; }).join("")}`;
}

function updateNewOrdersBadge() {
  if (!newOrdersBadge) return;
  const selectedChef = getSelectedChef();
  const myId = String(currentChefId);
  const count = Object.entries(allOrders || {}).filter(([orderId, order]) => { if (!order) return false; const status = getOrderStatus(order); const orderChefId = String(getAssignedChefId(orderId, order) || ""); const pendingStatuses = ["new", "approved", "cooking"]; if (!pendingStatuses.includes(normalizeKitchenStatus(status))) return false; if (selectedChef !== "all") return orderChefId === String(selectedChef); return orderChefId === myId; }).length;
  newOrdersBadge.textContent = count;
  newOrdersBadge.style.display = count > 0 ? "inline-flex" : "none";
}

/* =========================
   TABLE STATUS
========================= */
function deriveTableStatusFromOrders(tableNumber) {
  const orders = Object.values(allOrders || {}).filter(order => String(order.table || "") === String(tableNumber));
  if (!orders.length) return "free";
  if (orders.some(order => getOrderStatus(order) === "ready")) return "ready";
  if (orders.some(order => ["new", "approved", "cooking"].includes(getOrderStatus(order)))) return "busy";
  return "free";
}
function getTableStatusLabel(status) { if (status === "ready") return t("table_ready_pickup"); if (status === "busy") return t("table_busy"); return t("table_free"); }
function renderTableStatusBoard() {
  if (!tableStatusBoardDom) return;
  const tableSet = new Set();
  Object.values(allOrders || {}).forEach(order => { if (order?.table !== undefined && order?.table !== null && order?.table !== "") tableSet.add(String(order.table)); });
  Object.keys(window.tableStates || {}).forEach(tableNo => tableSet.add(String(tableNo)));
  const sortedTables = [...tableSet].sort((a, b) => Number(a) - Number(b));
  tableStatusBoardDom.innerHTML = `<div class="table-status-head">🪑 ${t("table_status_title")}</div><div class="table-status-grid">${sortedTables.map(tableNo => { const derived = deriveTableStatusFromOrders(tableNo); const saved = window.tableStates?.[tableNo]?.kitchenStatus || window.tableStates?.[tableNo]?.status; const finalStatus = saved || derived; return `<div class="table-status-card status-${finalStatus}"><div class="table-status-no">${t("table_label")} ${tableNo}</div><div class="table-status-text">${getTableStatusLabel(finalStatus)}</div></div>`; }).join("") || `<div class="table-status-empty">—</div>`}</div>`;
}
async function writeTableState(tableNo, patch = {}) {
  if (!tableNo) return;
  const currentSnap = await get(ref(db, `tables/${tableNo}`));
  const current = currentSnap.exists() ? currentSnap.val() : {};
  await update(ref(db, `tables/${tableNo}`), { ...patch, updatedAt: Date.now(), busy: !["free", "cleaning"].includes(String(patch.status || current.status || "").toLowerCase()) });
}

/* =========================
   CHEF CHAT
========================= */
function getChefChatRoomList() { return [{ id: PERSONAL_CHEF_ROOM, targetId: currentChefId, name: "Menga kelgan xabarlar" }]; }
function getChefChatMessages(roomId) {
  if (roomId !== PERSONAL_CHEF_ROOM) return [];
  return (window.chefChats?.[roomId]?.messages || []).filter(msg => { const msgTargetId = String(msg?.targetId || window.chefChats?.[roomId]?.meta?.targetId || currentChefId); const msgSenderId = String(msg?.senderId || ""); return msgTargetId === String(currentChefId) || msgSenderId === String(currentChefId); });
}
function renderChefChatRooms() {
  if (!chefChatRoomsDom) return;
  const rooms = getChefChatRoomList();
  chefChatRoomsDom.innerHTML = rooms.map(room => { const unread = (window.chefChats?.[room.id]?.messages || []).filter(msg => msg.senderId !== currentChefId).length; return `<button type="button" class="chef-room-item ${room.id === currentChefChatRoom ? "active" : ""}" data-room-id="${room.id}"><span>${escapeHtml(room.name)}</span>${unread ? `<span class="chef-room-count">${unread}</span>` : ""}</button>`; }).join("");
  chefChatRoomsDom.querySelectorAll(".chef-room-item").forEach(btn => { btn.addEventListener("click", () => { currentChefChatRoom = btn.dataset.roomId || "kitchen"; localStorage.setItem("chefChatRoom", currentChefChatRoom); renderChefChatRooms(); renderChefChatMessages(); }); });
}
function renderChefChatMessages() {
  if (!chefChatMessagesDom || !chefChatTitleDom) return;
  const rooms = getChefChatRoomList();
  const room = rooms.find(item => item.id === currentChefChatRoom) || rooms[0];
  const messages = getChefChatMessages(currentChefChatRoom);
  chefChatTitleDom.textContent = room?.name || t("chef_chat_title");
  chefChatMessagesDom.innerHTML = messages.length ? messages.slice(-50).map(msg => `<div class="chef-chat-message ${msg.senderId === currentChefId ? "me" : "other"}"><div class="chef-chat-text">${escapeHtml(msg.text || "")}</div><div class="chef-chat-meta">${escapeHtml(msg.senderName || "")} • ${formatOrderTime(msg.createdAt)}</div></div>`).join("") : `<div class="chef-chat-empty">${t("no_chef_messages")}</div>`;
  chefChatMessagesDom.scrollTop = chefChatMessagesDom.scrollHeight;
}
window.sendChefChatMessage = async function () {
  const text = chefChatInputDom?.value.trim();
  if (!text) return;
  const senderName = window.allChefs?.[currentChefId]?.name || localStorage.getItem("name") || t("chef_label");
  const now = Date.now();
  const roomId = PERSONAL_CHEF_ROOM;
  await update(ref(db, `chefChats/${roomId}/meta`), { roomId, targetId: currentChefId, updatedAt: now });
  await push(ref(db, `chefChats/${roomId}/messages`), { text, senderId: currentChefId, senderRole: "chef", senderName, targetId: currentChefId, createdAt: now });
  emitSocket("chef:chat-message", { roomId, text, senderId: currentChefId, senderName, targetId: currentChefId, createdAt: now });
  if (chefChatInputDom) chefChatInputDom.value = "";
};

/* =========================
   SIDEBAR MENU
========================= */
function renderPrepMenuSidebar() {
  const box = document.getElementById("prepMenuList");
  if (!box) return;
  const items = Object.entries(window.allMenu || {}).filter(([_, item]) => item && item.active !== false).sort((a, b) => getMenuName(a[1], "").localeCompare(getMenuName(b[1], ""), getLocale()));
  box.innerHTML = items.map(([id, item]) => { const name = getMenuName(item, "—"); const img = item.imgUrl || item.img || "img/no-image.png"; const prepTime = Number(item.prepTime || 30); return `<div class="prep-item"><img src="${img}" onerror="this.src='img/no-image.png'"><div class="prep-info"><b>${escapeHtml(name)}</b><div><input type="number" min="1" class="prep-input" id="prep_${id}" value="${prepTime}"><span>${t("minute_short")}</span></div><button class="prep-save" onclick="savePrepTime('${id}')">💾 ${t("prep_save_btn")}</button></div></div>`; }).join("");
}
window.savePrepTime = async function (menuId) {
  const input = document.getElementById("prep_" + menuId);
  if (!input) return;
  const prepTime = Number(input.value);
  if (!prepTime || prepTime < 1) { alert(t("prep_time_invalid")); return; }
  await update(ref(db, "menu/" + menuId), { prepTime });
  showNotification(`✅ ${t("prep_time_saved")}: ${prepTime} ${t("minute_short")}`);
};

/* =========================
   TV / FULLSCREEN / COUNTDOWNS
========================= */
window.toggleTVMode = function () { document.body.classList.toggle("tv-mode", !document.body.classList.contains("tv-mode")); localStorage.setItem("tvMode", document.body.classList.contains("tv-mode") ? "1" : "0"); };
window.toggleChefFullscreen = function () { if (typeof __baseToggleFullscreen === "function") __baseToggleFullscreen(); setTimeout(updateChefFullscreenButton, 150); };
window.toggleFullscreen = window.toggleChefFullscreen;
window.toggleStatsPanel = function () { if (!statsPanelEl) return; const isVisible = statsPanelEl.style.display === "block"; statsPanelEl.style.display = isVisible ? "none" : "block"; if (!isVisible) updateStatistics(); };
function updateChefFullscreenButton() { const btn = document.querySelector('.header-actions button[onclick*="toggleFullscreen"], .header-actions button[onclick*="toggleChefFullscreen"]'); if (btn) btn.textContent = document.fullscreenElement ? `⤢ ${t("fullscreen_btn")}` : t("fullscreen_btn"); }
function updateOrderCountdowns() {
  document.querySelectorAll(".order-card[data-ready-at]").forEach(card => {
    const readyAt = Number(card.dataset.readyAt || 0);
    const orderId = card.dataset.orderId || "";
    const timerEl = card.querySelector(".chef-order-timer div");
    const urgentEl = card.querySelector(".order-urgency-line");
    if (!readyAt || !timerEl) return;
    const diff = readyAt - Date.now();
    const delayedMinutes = diff < 0 ? Math.floor(Math.abs(diff) / 60000) : 0;
    const urgent = diff > 0 && diff <= 5 * 60 * 1000;
    const delayed = delayedMinutes >= 20;
    timerEl.textContent = formatRemainingTime(readyAt);
    card.classList.toggle("order-urgent", urgent);
    card.classList.toggle("order-delayed", delayed);
    card.classList.toggle("time-done", diff <= 0);
    if (urgentEl) {
      if (delayed) urgentEl.innerHTML = `🚨 ${t("delayed_order")} • ${delayedMinutes} ${t("minute_short")}`;
      else if (urgent) urgentEl.innerHTML = `🚨 ${t("urgent_order")}`;
      else if (diff <= 0) urgentEl.innerHTML = `✅ ${t("ready_time_reached")}`;
      else urgentEl.innerHTML = "";
    }
    if (delayed && orderId && !window.delayedAlertedOrders.has(orderId)) { window.delayedAlertedOrders.add(orderId); showNotification(`🚨 ${t("delayed_alert")} • #${orderId}`); }
  });
}
function startOrderCountdowns() { if (orderCountdownInterval) return; orderCountdownInterval = setInterval(updateOrderCountdowns, 1000); updateOrderCountdowns(); }

/* =========================
   REALTIME LISTENERS
========================= */
function listenUsers() {
  if (window.listeners?.users) window.listeners.users();
  window.listeners.users = onValue(ref(db, "users"), snap => {
    const users = snap.val() || {};
    window.allChefs = {};
    Object.entries(users).forEach(([id, user]) => { if (user.role === "chef") window.allChefs[id] = user; });
    fillChefFilter(users);
    const me = users[currentChefId] || Object.values(users).find(u => String(u.id || "") === String(currentChefId));
    chefActive = me?.active !== false;
    renderChefChatRooms();
    renderChefChatMessages();
    refreshUI();
  });
}

function listenMenu() {
  if (window.listeners?.menu) window.listeners.menu();
  window.listeners.menu = onValue(ref(db, "menu"), snap => { window.allMenu = snap.val() || {}; renderPrepMenuSidebar(); refreshUI(); });
}

function listenOrders() {
  if (window.listeners?.orders) {
    window.listeners.orders();
    window.listeners.orders = null;
  }
  window.listeners.orders = onValue(ref(db, "orders"), snap => {
    if (!snap.metadata?.fromCache && snap.exists()) {
      allOrders = snap.val() || {};
      renderChefOrders();
      const hasQueueOrders = Object.values(allOrders || {}).some(o =>
        ["queue", "new", "yangi"].includes(normalizeText(o.status || o.statusKey)) && !o.chefId
      );
      if (hasQueueOrders) {
        assignNextFromQueue().catch(err => console.error("Queue error:", err));
      }
    }
  });
}

function listenOrderChats() {
  if (window.listeners?.orderChats) window.listeners.orderChats();
  window.listeners.orderChats = onValue(ref(db, "orderChats"), snap => {
    const allChats = snap.val() || {};
    const nextChats = {};
    const myChefId = String(currentChefId || "").trim();
    const selectedChef = getSelectedChef();
    Object.entries(allChats).forEach(([orderId, rooms]) => {
      const chefRoom = rooms?.chef || {};
      const meta = chefRoom?.meta || {};
      const order = allOrders?.[orderId] || null;
      const assignedChefId = String(order?.chefId || meta.targetId || "").trim();
      if (!assignedChefId) return;
      if (selectedChef !== "all" && assignedChefId !== String(selectedChef).trim()) return;
      const messages = Object.entries(chefRoom?.messages || {}).map(([id, msg]) => ({ id, ...msg })).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
      nextChats[orderId] = { meta, messages };
    });
    window.orderChatsByOrder = nextChats;
    lastOrdersSignature = "";
    renderChefOrders();
  });
}
function listenChefChats() {
  if (window.listeners?.chefChats) window.listeners.chefChats();
  window.listeners.chefChats = onValue(ref(db, "chefChats"), snap => {
    const rooms = snap.val() || {};
    const room = rooms?.[PERSONAL_CHEF_ROOM] || {};
    const messages = Object.entries(room?.messages || {}).map(([id, msg]) => ({ id, ...msg })).filter(msg => { const msgTargetId = String(msg?.targetId || room?.meta?.targetId || currentChefId); const msgSenderId = String(msg?.senderId || ""); return msgTargetId === String(currentChefId) || msgSenderId === String(currentChefId); }).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    window.chefChats = { [PERSONAL_CHEF_ROOM]: { meta: { ...(room?.meta || {}), targetId: currentChefId }, messages } };
    currentChefChatRoom = PERSONAL_CHEF_ROOM;
    localStorage.setItem("chefChatRoom", currentChefChatRoom);
    renderChefChatRooms();
    renderChefChatMessages();
  });
}
function listenTableStates() {
  if (window.listeners?.tables) window.listeners.tables();
  window.listeners.tables = onValue(ref(db, "tables"), snap => { window.tableStates = snap.val() || {}; renderTableStatusBoard(); });
}
function listenMyStatus() {
  if (!currentChefId) return;
  if (window.listeners?.myStatus) window.listeners.myStatus();
  window.listeners.myStatus = onValue(ref(db, "users/" + currentChefId), snap => { const user = snap.val(); chefActive = user ? user.active !== false : true; });
}
function listenOrderTimelines() {
  if (window.listeners?.timelines) window.listeners.timelines();
  window.listeners.timelines = onValue(ref(db, "orderTimeline"), snap => { window.orderTimelines = snap.val() || {}; const modal = document.getElementById("chefDetailModal"); if (modal?.style.display === "flex") { const currentOrderId = document.getElementById("chefDetailContent")?.dataset?.orderId; if (currentOrderId && allOrders?.[currentOrderId]) renderChefOrderDetail(currentOrderId, allOrders[currentOrderId]); } });
}
function listenActivityLogs() {
  if (window.listeners?.logs) window.listeners.logs();
  window.listeners.logs = onValue(ref(db, "activityLogs"), snap => {
    const rows = Object.entries(snap.val() || {}).map(([id, row]) => ({ id, ...row }));
    window.kitchenAuditLogs = rows.filter(row => String(row.module || "").toLowerCase() === "kitchen" || String(row.userRole || "").toLowerCase() === "chef");
    renderKitchenActionLog();
  });
}
function listenStopList() {
  if (window.listeners?.stopList) window.listeners.stopList();
  window.listeners.stopList = onValue(ref(db, "stopList"), snap => {
    window.stopList = snap.val() || {};
    renderStopList();
    loadKitchenNotifications();
  });
}

function renderKitchenActionLog() {
  const root = document.getElementById("kitchenAuditList");
  if (!root) return;
  const logs = [...(window.kitchenAuditLogs || [])].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 30);
  root.innerHTML = `<div class="chef-widget-head">📜 Kitchen log</div><div class="chef-widget-body">${logs.length ? logs.map(log => `<div class="chef-chat-message other"><div class="chef-chat-text">${escapeHtml(log.action || "event")}${(log.payload?.orderId || log.target) ? ` • #${escapeHtml(log.payload?.orderId || log.target)}` : ""}</div><div class="chef-chat-meta">${escapeHtml(log.userName || log.actorName || "system")} • ${formatDateTime(log.createdAt)}</div></div>`).join("") : `<div class="chef-chat-empty">Kitchen log yo'q</div>`}</div>`;
}

async function assignNextFromQueue() {
  if (!allOrders || !window.allChefs) return;
  const activeChefs = Object.entries(window.allChefs || {}).filter(([_, chef]) => chef.active !== false);
  if (activeChefs.length === 0) return;
  const queueOrders = Object.entries(allOrders).filter(([_, o]) => ["queue", "new", "yangi"].includes(normalizeText(o.status || o.statusKey))).sort((a, b) => Number(a[1].queuedAt || a[1].createdAt || 0) - Number(b[1].queuedAt || b[1].createdAt || 0));
  if (queueOrders.length === 0) return;
  const [orderId] = queueOrders[0];
  const loads = activeChefs.map(([id]) => { const count = Object.values(allOrders || {}).filter(o => String(o.chefId) === String(id) && ["new", "approved", "cooking"].includes(normalizeKitchenStatus(o.status || o.statusKey))).length; return { id, count }; }).sort((a, b) => a.count - b.count);
  const selected = loads[0];
  await update(ref(db, "orders/" + orderId), { chefId: selected.id, status: "new", statusKey: "new", statusLabel: "new", assignedAt: Date.now(), updatedAt: Date.now() });
}

/* =========================
   SETTINGS
========================= */
const DEFAULT_CHEF_SETTINGS = { soundEnabled: true, autoPrint: false, compactMode: false, defaultFilter: "all", highlightLateOrders: true };
async function loadChefSettings() {
  const [globalSnap, localSnap] = await Promise.all([get(ref(db, "settings/kitchenDefaults")), get(ref(db, `chefSettings/${currentChefId}`))]);
  const globalDefaults = globalSnap.exists() ? globalSnap.val() : {};
  const localOverrides = localSnap.exists() ? localSnap.val() : {};
  window.chefSettings = { ...DEFAULT_CHEF_SETTINGS, ...globalDefaults, ...localOverrides };
  document.body.classList.toggle("compact-mode", !!window.chefSettings.compactMode);
  return window.chefSettings;
}

window.saveChefSettings = async function (patch = {}) {
  window.chefSettings = { ...DEFAULT_CHEF_SETTINGS, ...(window.chefSettings || {}), ...(patch || {}) };
  localStorage.setItem("chefSettings", JSON.stringify(window.chefSettings));
  await set(ref(db, `chefSettings/${currentChefId}`), window.chefSettings);
  document.body.classList.toggle("compact-mode", !!window.chefSettings.compactMode);
  renderKitchenStats();
  renderKitchenNotifications();
  showChefNotification("⚙️ Settings saved");
};

window.toggleKitchenSound = async () => window.saveChefSettings({ soundEnabled: !window.chefSettings?.soundEnabled });
window.toggleAutoPrint = async () => window.saveChefSettings({ autoPrint: !window.chefSettings?.autoPrint });
window.toggleCompactMode = async () => window.saveChefSettings({ compactMode: !window.chefSettings?.compactMode });
window.setDefaultKitchenFilter = async (value = "all") => { await window.saveChefSettings({ defaultFilter: value || "all" }); localStorage.setItem("chefStatusFilter", value || "all"); refreshUI(); };

/* =========================
   DETAIL MODAL
========================= */
/* =========================
   DETAIL MODAL (Tarjima ulangan)
========================= */
function renderChefOrderDetail(orderId, order) {
  const detail = document.getElementById("chefDetailContent");
  if (!detail || !order) return;
  detail.dataset.orderId = orderId;
  const status = normalizeKitchenStatus(getOrderStatus(order));
  const chefName = getAssignedChefName(orderId, order);
  const total = Object.values(order?.items || {}).reduce((sum, item) => { const menu = getOrderItemMenu(item) || {}; const price = Number(item?.price || menu?.price || 0); return sum + (price * Number(item?.qty || 1)); }, 0);
  
  detail.innerHTML = `
    <div class="chef-detail-grid">
      <div class="chef-detail-card">
        <h4>${t("basic_info") || "Asosiy ma'lumot"}</h4>
        <div><b>${t("order") || "Order ID"}:</b> #${escapeHtml(orderId)}</div>
        <div><b>${t("table") || "Stol"}:</b> ${escapeHtml(order?.table || "-")}</div>
        <div><b>${t("order_status") || "Status"}:</b> ${escapeHtml(t("status_" + status) || status)}</div>
        <div><b>${t("chef_label") || "Chef"}:</b> ${escapeHtml(chefName)}</div>
        <div><b>${t("created_at") || "Yaratildi"}:</b> ${formatDateTime(order?.createdAt)}</div>
        <div><b>${t("total_label") || "Total"}:</b> ${formatMoney(total)}</div>
      </div>
      <div class="chef-detail-card">
        <h4>${t("special_request_label") || "Special instructions"}</h4>
        ${renderOrderSpecialInstructions(order)}
      </div>
      <div class="chef-detail-card">
        <h4>${t("items_label") || "Items"}</h4>
        ${renderOrderItemsDetailed(orderId, order)}
        <div class="chef-detail-actions">
          <button type="button" onclick="acceptOrder('${escapeJsString(orderId)}')">✅ ${t("approve") || "Accept"}</button>
          <button type="button" onclick="startCooking('${escapeJsString(orderId)}')">🔥 ${t("status_cooking") || "Start"}</button>
          <button type="button" onclick="markOrderReady('${escapeJsString(orderId)}')">🍽 ${t("status_ready") || "Ready"}</button>
        </div>
      </div>
    </div>`;
}

function renderOrderSpecialInstructions(order) {
  const parts = [];
  if (order?.clientRequest) parts.push(`<div>📝 <b>Mijoz izohi:</b> ${escapeHtml(order.clientRequest)}</div>`);
  if (order?.allergyNote) parts.push(`<div>⚠️ <b>Allergiya:</b> ${escapeHtml(order.allergyNote)}</div>`);
  if (order?.specialNote) parts.push(`<div>📌 <b>Special note:</b> ${escapeHtml(order.specialNote)}</div>`);
  if (order?.reservationNote) parts.push(`<div>📅 <b>Reservation note:</b> ${escapeHtml(order.reservationNote)}</div>`);
  return parts.length ? parts.join("") : `<div class="detail-empty">Qo'shimcha izoh yo'q</div>`;
}

function renderOrderTimeline(orderId) {
  const rows = Object.entries(window.orderTimelines?.[orderId] || {}).map(([id, row]) => ({ id, ...row })).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  if (!rows.length) return `<div class="detail-empty">Timeline yo'q</div>`;
  return rows.map(row => `<div class="timeline-row"><div><b>${escapeHtml(row?.eventType || "event")}</b></div><small>${formatDateTime(row?.createdAt)}</small><div>${escapeHtml(row?.actorName || "system")}</div></div>`).join("");
}

window.openChefOrderDetail = function (orderId) { ensureChefEnhancementLayout(); const modal = document.getElementById("chefDetailModal"); const order = allOrders?.[orderId]; if (!modal || !order) return; renderChefOrderDetail(orderId, order); modal.style.display = "flex"; };
window.closeChefOrderDetail = function () { const modal = document.getElementById("chefDetailModal"); if (modal) modal.style.display = "none"; };

/* =========================
   STATS UI / REFRESH
========================= */
function calculateKitchenStats() {
  const entries = Object.entries(allOrders || {});
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const stats = { total: entries.length, newOrders: 0, cooking: 0, ready: 0, delayed: 0, avgPrepMinutes: 0, completedToday: 0 };
  let completedCount = 0, totalCompletedMinutes = 0;
  entries.forEach(([_, order]) => {
    const status = getOrderStatus(order);
    const normalizedStatus = normalizeKitchenStatus(status);
    if (["new", "approved"].includes(normalizedStatus)) stats.newOrders += 1;
    if (normalizedStatus === "cooking") stats.cooking += 1;
    if (normalizedStatus === "ready") stats.ready += 1;
    if (getRemainingInfo(order).delayed) stats.delayed += 1;
    if (Number(order?.finishedAt || 0) >= startOfDay.getTime()) stats.completedToday += 1;
    const duration = getOrderWaitDuration(order);
    if (duration > 0 && Number(order?.finishedAt || 0) > 0) { completedCount += 1; totalCompletedMinutes += Math.round(duration / 60000); }
  });
  stats.avgPrepMinutes = completedCount ? Math.round(totalCompletedMinutes / completedCount) : 0;
  return stats;
}
function calculateChefOwnStats() { return calculateAllStats?.()[currentChefId] || { active: 0, fast: 0, normal: 0, ready: 0, total: 0, totalWorkMinutes: 0, delayed: 0, loadPercent: 0 }; }
function renderChefPerformanceCard() { const mine = calculateChefOwnStats(); return `<div class="chef-performance-card"><div><b>👨‍🍳 Mening load:</b> ${mine.active}</div><div><b>⚡ Fast:</b> ${mine.fast}</div><div><b>✅ Ready:</b> ${mine.ready}</div><div><b>⏱ Work:</b> ${mine.totalWorkMinutes} ${t("minute_short")}</div></div>`; }
function renderKitchenStats() {
  const root = document.getElementById("chefsTodayStats");
  if (!root) return;
  const stats = calculateKitchenStats();
  root.innerHTML = `<div class="kitchen-stats-grid"><div class="stat-card"><b>🆕 New</b><span>${stats.newOrders}</span></div><div class="stat-card"><b>🔥 Cooking</b><span>${stats.cooking}</span></div><div class="stat-card"><b>✅ Ready</b><span>${stats.ready}</span></div><div class="stat-card"><b>🚨 Delayed</b><span>${stats.delayed}</span></div><div class="stat-card"><b>⏱ Avg prep</b><span>${stats.avgPrepMinutes} ${t("minute_short")}</span></div><div class="stat-card"><b>📦 Today</b><span>${stats.completedToday}</span></div>${renderChefPerformanceCard()}</div>`;
}
function updateKitchenRealtimeStats() { renderKitchenStats(); if (typeof updateStatistics === "function") updateStatistics(); }
function applyStaticTranslations() {
  document.querySelectorAll("[data-i18n]").forEach(el => { const key = el.dataset.i18n; if (key) el.textContent = t(key); });
  document.querySelectorAll("[data-i18n-title]").forEach(el => { const key = el.dataset.i18nTitle; if (key) el.title = t(key); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => { const key = el.dataset.i18nPlaceholder; if (key) el.placeholder = t(key); });
  document.title = `Foodify — ${t("chef_page_title")}`;
}
function applyChefPageTranslations() { applyStaticTranslations(); updateChefFullscreenButton(); renderKitchenStats(); renderKitchenNotifications(); renderStopList(); renderKitchenActionLog(); renderCategoryFilter?.(); renderSubFilter?.(getSelectedCategory?.() || "all"); renderChefFilters(); }
function renderChefFilters() {
  ensureChefEnhancementLayout();
  const statusEl = document.getElementById("chefStatusFilter"), tableEl = document.getElementById("chefTableFilter"), searchEl = document.getElementById("chefSearchInput");
  if (statusEl) statusEl.value = localStorage.getItem("chefStatusFilter") || window.chefSettings?.defaultFilter || "all";
  if (tableEl) tableEl.value = localStorage.getItem("chefTableFilter") || "";
  if (searchEl) searchEl.value = localStorage.getItem("chefSearch") || "";
}

function refreshUI() {
  ensureChefEnhancementLayout();
  applyChefPageTranslations();
  renderPrepMenuSidebar?.();
  renderChefOrders();
  renderTableStatusBoard?.();
  renderChefChatRooms?.();
  renderChefChatMessages?.();
  updateKitchenRealtimeStats();
  updateNewOrdersBadge?.();
  loadKitchenNotifications();
}

function startKitchenTicker() {
  if (window.__kitchenTickerTimer) return;
  window.__kitchenTickerTimer = setInterval(() => {
    updateOrderCountdowns();
    highlightLateOrders();
  }, 1000);
}

function highlightLateOrders() {
  const enabled = window.chefSettings?.highlightLateOrders !== false;
  document.querySelectorAll(".chef-order-card[data-order-id]").forEach(card => {
    const orderId = card.dataset.orderId;
    const order = allOrders?.[orderId];
    if (!order) return;
    const remaining = getRemainingInfo(order);
    card.classList.toggle("order-delayed", enabled && remaining.delayed);
    card.classList.toggle("order-urgent", enabled && remaining.urgent);
  });
}

function startKitchenNotificationsAutoRefresh() { if (window.__kitchenNotificationTimer) return; window.__kitchenNotificationTimer = setInterval(loadKitchenNotifications, 10000); }

/* =========================
   EVENTS
========================= */
function bindEvents() {
  if (window.__chefEnhancementEventsBound) return;
  window.__chefEnhancementEventsBound = true;
  if (langSelect) { langSelect.value = currentLang; langSelect.addEventListener("change", e => { currentLang = e.target.value; localStorage.setItem("lang", currentLang); renderCategoryFilter(); lastOrdersSignature = ""; refreshUI(); }); }
  chefFilterEl?.addEventListener("change", e => { localStorage.setItem("chefFilter", e.target.value); refreshUI(); });
  categoryFilterEl?.addEventListener("change", e => { localStorage.setItem("categoryFilter", e.target.value); localStorage.setItem("subFilter", "all"); renderSubFilter(e.target.value); refreshUI(); });
  subFilterEl?.addEventListener("change", e => { localStorage.setItem("subFilter", e.target.value); refreshUI(); });
  document.addEventListener("change", e => { if (e.target?.id === "chefStatusFilter") { localStorage.setItem("chefStatusFilter", e.target.value); refreshUI(); } });
  document.addEventListener("input", e => {
    if (e.target?.id === "chefSearchInput") {
      localStorage.setItem("chefSearch", e.target.value);
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(refreshUI, 300);
    }
  });
  chefChatSendBtnDom?.addEventListener("click", () => window.sendChefChatMessage?.());
  chefChatInputDom?.addEventListener("keydown", e => { if (e.key === "Enter") window.sendChefChatMessage?.(); });
  document.addEventListener("click", e => { if (statsPanelEl && !statsPanelEl.contains(e.target) && !e.target.closest(".btn-stats-toggle")) statsPanelEl.style.display = "none"; if (e.target?.id === "chefDetailModal") window.closeChefOrderDetail(); });
  document.addEventListener("fullscreenchange", updateChefFullscreenButton);
  if (localStorage.getItem("tvMode") === "1") document.body.classList.add("tv-mode");
}

/* =========================
   INIT
========================= */
async function initChef() {
  if (window.__chefInitStarted) return;
  window.__chefInitStarted = true;
  ensureChefEnhancementLayout();
  await ensureChefUserExists();
  await ensureChefAccess("kitchen_access");
  await loadChefSettings();
  await loadStopList();
  applyChefPageTranslations();
  renderChefFilters();
  bindEvents();
  listenSocket();
  listenUsers();
  listenMenu();
  listenOrders();
  listenOrderChats();
  listenChefChats();
  listenTableStates();
  listenMyStatus();
  listenStopList();
  listenOrderTimelines();
  listenActivityLogs();
  assignNextFromQueue().catch(console.error);
  startKitchenTicker();
  startKitchenNotificationsAutoRefresh();
  updateKitchenRealtimeStats();
  if (!window.__kitchenRealtimeTimer) window.__kitchenRealtimeTimer = setInterval(updateKitchenRealtimeStats, 10000);
}
document.addEventListener("DOMContentLoaded", initChef);