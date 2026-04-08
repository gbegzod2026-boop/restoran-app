// admin.js 
import { CATEGORY_DATA } from "./shared.js";
import { t, getLang, setLang, applyLang, onLangChange } from "./i18n.js";

import { initializeApp, getApps }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import {
  getDatabase, ref, onValue, update, get, set, remove, push
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

import {
  getAuth, signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

window.allUsers = {};

const crmState = { customers: [], filtered: [] };
const reservationState = { list: [] };
const feedbackState = { list: [] };
const notificationsState = { list: [] };
const tablesAdvancedState = { tables: {}, orders: {} };

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
const storage = getStorage(app);
const auth = getAuth(app);

signInAnonymously(auth)
  .then(() => console.log(t("firebase_auth_ok_log")))
  .catch(console.error);

const socket = typeof io !== "undefined" ? io() : null;

const langSelect = document.getElementById("langSelect");
if (langSelect) {
  langSelect.value = getLang();
  langSelect.addEventListener("change", e => setLang(e.target.value));
}

function updateFullscreenButton() {
  const isFullscreen = !!document.fullscreenElement;
  const btn = document.getElementById("fullscreenBtn");
  const span = document.getElementById("fullscreenBtnText");
  if (span) span.textContent = isFullscreen ? t("exit_fullscreen") : t("fullscreen");
  if (btn) btn.innerHTML = isFullscreen
    ? `🡼 <span id="fullscreenBtnText">${t("exit_fullscreen")}</span>`
    : `⛶ <span id="fullscreenBtnText">${t("fullscreen")}</span>`;
}

window.toggleFullscreen = async function () {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (err) {
    console.error(t("fullscreen_error_log"), err);
    showAdminNotification(t("fullscreen_not_supported"), "error");
  }
};
document.addEventListener("fullscreenchange", updateFullscreenButton);

async function saveMaxTable() {
  const input = document.getElementById("maxTablesInput");
  if (!input) return;

  const value = Number(input.value);
  if (!value || value < 1) {
    alert(t("alerts.invalid_number"));
    return;
  }

  await update(ref(db, "settings"), {
    maxTable: value
  });

  alert(t("alerts.saved"));
}

window.saveMaxTable = saveMaxTable;

get(ref(db, "settings/maxTable")).then(snap => {
  if (snap.exists()) {
    const input = document.getElementById("maxTablesInput");
    if (input) input.value = snap.val();
  }
});

window.allMenu = {};
window.allOrders = {};

let editingItemId = null;
let oldImagePath = "";
let ordersChart = null;
let statusChart = null;
let topFoodsChart = null;
let searchQuery = "";
let undoStack = null;
let undoTimer = null;
let currentStaffId = null;
let currentStaffRole = null;

const ordersList = document.getElementById("ordersList");
const foodNameInput = document.getElementById("foodNameInput");
const addPrice = document.getElementById("addPrice");
const categorySelect = document.getElementById("category");
const subcategorySelect = document.getElementById("subcategory");
const addImgInput = document.getElementById("addImgInput");
const addFileName = document.getElementById("addFileName");
const addMenuBtn = document.getElementById("addMenuBtn");
const menuList = document.getElementById("menuList");
const editModal = document.getElementById("editModal");
const editPriceInput = document.getElementById("editPrice");
const editName = document.getElementById("editName");
const editCategory = document.getElementById("editCategory");
const editSubCategory = document.getElementById("editSubCategory");
const editImgInput = document.getElementById("editImgInput");
const editFileName = document.getElementById("editFileName");
const filterOrderCategory = document.getElementById("filterOrderCategory");
const filterOrderSubcategory = document.getElementById("filterOrderSubcategory");
const filterPaymentType = document.getElementById("filterPaymentType");
const filterPaymentStatus = document.getElementById("filterPaymentStatus");

[filterPaymentType, filterPaymentStatus, filterOrderCategory, filterOrderSubcategory]
  .forEach(el => el?.addEventListener("change", () => renderOrders(window.allOrders)));

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(value = "") {
  return String(value).trim().toLowerCase();
}

function normalizePhone(phone = "") {
  const cleaned = String(phone || "").replace(/\D/g, "");
  return cleaned.slice(-9);
}

function isCountableVisit(order = {}) {
  const status = normalizeText(order.status || order.statusKey || "");
  return (
    order.payment?.paid === true ||
    order.tableClosed === true ||
    ["approved", "cooking", "ready", "closed", "tasdiqlandi", "tayyorlanmoqda", "tayyor", "yopildi"].includes(status)
  );
}

function countCustomerVisitsByPhone(phone, ordersObj = {}, excludeOrderId = "") {
  const target = normalizePhone(phone);
  if (!target) return 0;

  let count = 0;

  Object.entries(ordersObj || {}).forEach(([id, order]) => {
    if (excludeOrderId && id === excludeOrderId) return;

    const orderPhone = normalizePhone(
      order.customerPhone ||
      order.phone ||
      order.clientPhone ||
      ""
    );

    if (!orderPhone) return;
    if (orderPhone !== target) return;
    if (!isCountableVisit(order)) return;

    count++;
  });

  return count;
}

function sumCustomerPaidTotalByPhone(phone, ordersObj = {}, includeCurrentOrder = null) {
  const target = normalizePhone(phone);
  if (!target) return 0;

  let total = 0;

  Object.values(ordersObj || {}).forEach(order => {
    const orderPhone = normalizePhone(
      order.customerPhone ||
      order.phone ||
      order.clientPhone ||
      ""
    );

    if (orderPhone !== target) return;
    if (!isCountableVisit(order)) return;

    total += Number(order.finalTotal || order.total || 0);
  });

  if (includeCurrentOrder) {
    total += Number(includeCurrentOrder.finalTotal || includeCurrentOrder.total || 0);
  }

  return total;
}

function translateStatus(value = "") {
  const raw = normalizeText(value);

  const map = {
    yangi: "new",
    tasdiqlandi: "approved",
    tayyorlanmoqda: "cooking",
    tayyor: "ready",
    yopildi: "closed",

    new: "new",
    approved: "approved",
    cooking: "cooking",
    ready: "ready",
    closed: "closed",

    pending: "pending",
    confirmed: "confirmed",
    seated: "seated",
    completed: "completed",
    no_show: "no_show",
    canceled: "canceled",
    cancelled: "canceled",

    free: "free",
    reserved: "reserved",
    billing: "billing",
    cleaning: "cleaning",
    active: "active",
    open: "open"
  };

  const normalized = map[raw] || raw;
  const key = `status_${normalized}`;
  const translated = t(key);

  return translated === key ? (value || uiEmpty()) : translated;
}

function translateLoyalty(value = "") {
  const key = `loyalty_${normalizeText(value)}`;
  const translated = t(key);
  return translated === key ? (value || uiEmpty()) : translated;
}

function translateNotificationType(value = "") {
  const key = `notification_type_${normalizeText(value)}`;
  const translated = t(key);
  return translated === key ? (value || uiEmpty()) : translated;
}

function tr(key, fallback = "") {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

function uiEmpty() {
  return tr("empty_value", "—");
}

function translateAuditSeverity(value = "") {
  const key = `audit_severity_${normalizeText(value)}`;
  const translated = t(key);
  return translated === key ? (value || uiEmpty()) : translated;
}


function translateAuditModule(value = "") {
  const raw = normalizeText(value).replace(/\s+/g, "_");

  const map = {
    "роли": "roles",
    "обновление": "update",
    "критично": "critical",
    "настройки_crm": "crm_settings",
    "crm_settings": "crm_settings",
    "система": "system"
  };

  const key = map[raw] || raw;
  const translated = t(`audit_module_value_${key}`);

  return translated.includes("audit_module_value_") ? (value || uiEmpty()) : translated;
}

function translateAuditAction(value = "") {
  const raw = normalizeText(value).replace(/\s+/g, "_");

  const map = {
    "обновление": "update",
    "создание": "create",
    "закрытие": "close"
  };

  const key = map[raw] || raw;
  const translated = t(`audit_action_value_${key}`);

  return translated.includes("audit_action_value_") ? (value || uiEmpty()) : translated;
}

function translateAuditTarget(value = "") {
  const raw = String(value).toLowerCase().trim();
  const key = `audit_target_${raw}`;
  const translated = t(key);
  return translated === key ? (value || uiEmpty()) : translated;
}

function translateAuditUserName(name = "") {
  const raw = String(name).toLowerCase().trim();
  if (["admin", "админ", "администратор"].includes(raw)) {
    return t("admin");
  }
  return name;
}

function translateZone(value = "") {
  const key = `table_zone_${normalizeText(value)}`;
  const translated = t(key);
  return translated === key ? (value || uiEmpty()) : translated;
}

function translatePulse(value = "") {
  const key = `table_pulse_${normalizeText(value)}`;
  const translated = t(key);
  return translated === key ? (value || uiEmpty()) : translated;
}

function formatMoney(value = 0) {
  return `${Number(value || 0).toLocaleString()} ${t("currency")}`;
}

function formatDateTime(value) {
  if (!value) return uiEmpty();
  try { return new Date(value).toLocaleString(); }
  catch { return uiEmpty(); }
}

function getOrderTimestamp(order) {
  return Number(
    order?.updatedAt ||
    order?.createdAt ||
    order?.payment?.approvedAt ||
    order?.payment?.requestedAt ||
    0
  );
}

function getCustomerDisplayName(order = {}, profile = {}) {
  return profile.name || order.customerName || order.clientName ||
    order.name || `${t("table")} ${order.table || uiEmpty()}`;
}

function getCustomerPhone(order = {}, profile = {}) {
  return profile.phone || order.customerPhone || order.phone || "";
}

function getLoyaltyLevel(totalSpent = 0, visits = 0) {
  if (visits >= 5) return "gold";
  if (visits >= 3) return "silver";
  return "bronze";
}

function getLoyaltyDiscountPercent(visits = 0) {
  if (visits >= 5) return 10;
  if (visits >= 3) return 5;
  return 0;
}

function buildFavoriteItems(map = {}, limit = 4) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}

function getReservationStatusActions(status) {
  const s = String(status || "pending").toLowerCase();

  if (s === "pending") {
    return [
      { label: t("confirm_btn"), status: "confirmed" },
      { label: t("cancel_btn"), status: "canceled" }
    ];
  }

  if (s === "confirmed") {
    return [
      { label: t("seated_btn"), status: "seated" },
      { label: t("no_show_btn"), status: "no_show" }
    ];
  }

  if (s === "seated") {
    return [
      { label: t("complete_btn"), status: "completed" }
    ];
  }

  return [];
}

function buildCustomerMapFromOrders(ordersObj = {}, customerProfiles = {}, users = {}) {
  const map = {};

  Object.entries(ordersObj || {}).forEach(([orderId, order]) => {
    const phone = getCustomerPhone(order);
    const customerId = order.customerId || phone || `table_${order.table || "unknown"}`;

    if (!map[customerId]) {
      map[customerId] = {
        id: customerId,
        name: getCustomerDisplayName(order),
        phone: phone || "",
        visits: 0, totalSpent: 0, cashbackBalance: 0,
        promoCodesUsed: new Set(), favoriteItemsMap: {},
        recentOrders: [], lastVisit: 0, loyalty: "bronze"
      };
    }

    const customer = map[customerId];
    customer.visits += 1;
    customer.totalSpent += Number(order.finalTotal || order.total || 0);
    customer.lastVisit = Math.max(customer.lastVisit, getOrderTimestamp(order));

    if (order.promoCode) customer.promoCodesUsed.add(order.promoCode);

    Object.values(order.items || {}).forEach(item => {
      const menuItem = window.allMenu?.[item.menuId || item.id || item.itemId];
      const itemName = getTranslatedItemName(item, menuItem, getLang());
      customer.favoriteItemsMap[itemName] =
        (customer.favoriteItemsMap[itemName] || 0) + Number(item.qty || 0);
    });

    customer.recentOrders.push({
      orderId,
      orderNumber: order.orderNumber || orderId,
      table: order.table || uiEmpty(),
      total: Number(order.finalTotal || order.total || 0),
      status: order.statusLabel || order.status || uiEmpty(),
      createdAt: getOrderTimestamp(order)
    });
  });

  Object.entries(customerProfiles || {}).forEach(([id, profile]) => {
    const key = profile.phone || id;
    if (!map[key]) {
      map[key] = {
        id: key, name: profile.name || uiEmpty(), phone: profile.phone || "",
        visits: Number(profile.visits || 0), totalSpent: Number(profile.totalSpent || 0),
        cashbackBalance: Number(profile.cashbackBalance || 0),
        promoCodesUsed: new Set(profile.promoCodesUsed || []),
        favoriteItemsMap: {}, recentOrders: [],
        lastVisit: Number(profile.lastVisit || 0), loyalty: profile.loyalty || "bronze"
      };
    } else {
      map[key].name = profile.name || map[key].name;
      map[key].cashbackBalance = Number(profile.cashbackBalance || map[key].cashbackBalance || 0);
      map[key].lastVisit = Math.max(Number(profile.lastVisit || 0), map[key].lastVisit || 0);
      (profile.promoCodesUsed || []).forEach(code => map[key].promoCodesUsed.add(code));
    }
  });

  Object.entries(users || {}).forEach(([id, user]) => {
    if (user.role !== "client") return;
    const key = user.phone || id;
    if (!map[key]) {
      map[key] = {
        id: key, name: user.name || uiEmpty(), phone: user.phone || "",
        visits: 0, totalSpent: 0,
        cashbackBalance: Number(user.cashbackBalance || 0),
        promoCodesUsed: new Set(), favoriteItemsMap: {},
        recentOrders: [], lastVisit: Number(user.lastVisit || 0), loyalty: "bronze"
      };
    }
  });

  return Object.values(map).map(customer => ({
    ...customer,
    favoriteItems: buildFavoriteItems(customer.favoriteItemsMap, 4),
    promoCodesUsed: Array.from(customer.promoCodesUsed),
    loyalty: getLoyaltyLevel(customer.totalSpent, customer.visits),
    recentOrders: customer.recentOrders
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5)
  })).sort((a, b) => b.totalSpent - a.totalSpent);
}

// ─── Auto translate ───────────────────────────────────────
async function autoTranslate(text, targetLang) {
  try {
    const res = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=uz&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`
    );
    const data = await res.json();
    return data[0][0][0];
  } catch (e) {
    console.warn(t("translate_error_log"), e);
    return text;
  }
}

function getTranslatedItemName(item, menuItem = null, lang = getLang()) {
  if (menuItem?.name) {
    if (typeof menuItem.name === "object") {
      return menuItem.name[lang] || menuItem.name.uz || menuItem.name.ru || menuItem.name.en || uiEmpty();
    }
    return menuItem.name || uiEmpty();
  }
  if (item?.name) {
    if (typeof item.name === "object") {
      return item.name[lang] || item.name.uz || item.name.ru || item.name.en || uiEmpty();
    }
    return item.name || uiEmpty();
  }
  return uiEmpty();
}

function showToast(text, type = "success") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = text;
  toast.className = `toast show ${type}`;
  setTimeout(() => toast.classList.remove("show"), 3000);
}

function showAdminNotification(text, type = "success") {
  const n = document.createElement("div");
  n.className = `admin-toast ${type}`;
  n.innerText = text;
  document.body.appendChild(n);
  setTimeout(() => n.classList.add("show"), 50);
  setTimeout(() => {
    n.classList.remove("show");
    setTimeout(() => n.remove(), 300);
  }, 3000);
}

function showNotification(text) {
  const n = document.getElementById("notification");
  if (!n) return;
  n.innerText = text;
  n.classList.add("show");
  setTimeout(() => n.classList.remove("show"), 3000);
}

// ─── Role check ──────────────────────────────────────────
if (localStorage.getItem("role") !== "admin") {
  alert(t("alerts.not_admin_full"));
  location.href = "login.html";
}

// ─── File name display ───────────────────────────────────
addImgInput?.addEventListener("change", () => {
  if (addFileName) addFileName.textContent = addImgInput.files?.[0]?.name || t("file_not_selected");
});
editImgInput?.addEventListener("change", () => {
  if (editFileName) editFileName.textContent = editImgInput.files?.[0]?.name || t("file_not_selected");
});

// ─── Category render ─────────────────────────────────────
function renderCategories(select, selected = "") {
  if (!select) return;
  select.innerHTML = `<option value="">${t("select_category")}</option>`;
  CATEGORY_DATA.categories.forEach(cat => {
    select.innerHTML += `<option value="${cat.id}" ${cat.id === selected ? "selected" : ""}>${t(cat.nameKey)}</option>`;
  });
}

function renderSubcategories(select, categoryId, selected = "") {
  if (!select) return;
  select.innerHTML = `<option value="">${t("select_subcategory")}</option>`;
  const catObj = CATEGORY_DATA.categories.find(c => c.id === categoryId);
  if (!catObj) return;
  catObj.sub.forEach(subKey => {
    select.innerHTML += `<option value="${subKey}" ${subKey === selected ? "selected" : ""}>${t(subKey)}</option>`;
  });
}

function initOrderCategoryFilter() {
  if (!filterOrderCategory || !filterOrderSubcategory) return;
  filterOrderCategory.innerHTML = `<option value="all">${t("all_categories")}</option>`;
  CATEGORY_DATA.categories.forEach(cat => {
    filterOrderCategory.innerHTML += `<option value="${cat.id}">${t(cat.nameKey)}</option>`;
  });
  filterOrderSubcategory.innerHTML = `<option value="all">${t("all_subcategories")}</option>`;
}

filterOrderCategory?.addEventListener("change", () => {
  const catId = filterOrderCategory.value;
  filterOrderSubcategory.innerHTML = `<option value="all">${t("all_subcategories")}</option>`;
  if (catId !== "all") {
    const cat = CATEGORY_DATA.categories.find(c => c.id === catId);
    cat?.sub.forEach(subKey => {
      filterOrderSubcategory.innerHTML += `<option value="${subKey}">${t(subKey)}</option>`;
    });
  }
  renderOrders(window.allOrders);
});

filterOrderSubcategory?.addEventListener("change", () => renderOrders(window.allOrders));
categorySelect?.addEventListener("change", () => renderSubcategories(subcategorySelect, categorySelect.value));
editCategory?.addEventListener("change", () => renderSubcategories(editSubCategory, editCategory.value));

function renderOrders(orders) {
  const list = document.getElementById("ordersList");
  if (!list) return;
  list.innerHTML = "";

  try {
    const priority = {
      yangi: 1, new: 1, queue: 1,
      tasdiqlandi: 2, approved: 2,
      tayyorlanmoqda: 3, cooking: 3,
      tayyor: 4, ready: 4,
      yopildi: 5, closed: 5
    };

    let filtered = applyOrderFilters(orders);
    if (typeof applyChefFilter === 'function') filtered = applyChefFilter(filtered);

    filtered
      .sort((a, b) => {
        const sa = String(a[1].statusKey || a[1].status || "").trim().toLowerCase();
        const sb = String(b[1].statusKey || b[1].status || "").trim().toLowerCase();

        if ((priority[sa] || 99) !== (priority[sb] || 99)) {
          return (priority[sa] || 99) - (priority[sb] || 99);
        }
        const ta = a[1].createdAt || 0;
        const tb = b[1].createdAt || 0;

        return tb - ta;
      })
      .forEach(([id, order]) => {
        if (typeof renderOrderCard === 'function') {
          list.innerHTML += renderOrderCard(id, order);
        }
      });
  } catch (e) {
    console.error("renderOrders xatosi:", e);
    list.innerHTML = `<p style="color:red;">${t("error_rendering_orders")}</p>`;
  }
}

function applyOrderFilters(ordersObj) {
  const paymentStatus = filterPaymentStatus?.value || "all";
  const category = filterOrderCategory?.value || "all";
  const subcategory = filterOrderSubcategory?.value || "all";
  const paymentMethod = filterPaymentType?.value || "all";

  return Object.entries(ordersObj || {}).filter(([_, order]) => {
    if (paymentStatus !== "all") {
      const paid = order.payment?.paid === true;
      if (paymentStatus === "paid" && !paid) return false;
      if (paymentStatus === "unpaid" && paid) return false;
    }

    if (paymentMethod !== "all") {
      const method = normalizePaymentMethod(order.payment?.method);
      if (method !== paymentMethod) return false;
    }

    if (category !== "all" || subcategory !== "all") {
      const match = Object.entries(order.items || {}).some(([_, item]) => {
        const menuItem = window.allMenu?.[item.menuId || item.id || item.itemId];
        if (!menuItem) return false;
        if (category !== "all" && menuItem.category !== category) return false;
        if (subcategory !== "all" && menuItem.subcategory !== subcategory) return false;
        return true;
      });

      if (!match) return false;
    }

    return true;
  });
}

function renderOrderCard(id, order) {
  try {
    const items = Object.values(order.items || []);
    const imagesHtml = items.length
      ? items.map(i => `<img src="${i.img || '/img/no-image.png'}" onerror="this.src='/img/no-image.png'" class="order-img" alt="${t("order_image_alt")}">`).join("")
      : `<img src="/img/no-image.png" class="order-img" alt="${t("order_image_alt")}">`;

    const total = typeof order.finalTotal === "number" ? order.finalTotal : typeof order.total === "number" ? order.total : items.reduce((s, i) => s + (Number(i.price) * Number(i.qty)), 0);

    const paymentText = order.payment?.method ? t("payment_" + order.payment.method) : t("status_pending");
    const rawStatus = String(order.status || "").toLowerCase().trim();

    const statusMap = {
      yangi: "new", tasdiqlandi: "approved", tayyorlanmoqda: "cooking", tayyor: "ready", queue: "queue", yopildi: "closed",
      new: "new", approved: "approved", cooking: "cooking", ready: "ready", closed: "closed",
      pending: "pending", completed: "completed", cancelled: "cancelled"
    };

    const cssStatusKey = statusMap[rawStatus] || rawStatus || "unknown";
    let statusText = t("status_" + cssStatusKey);
    if (statusText === "status_" + cssStatusKey) statusText = order.statusLabel || order.status || t("unknown_status");

    const isNew = rawStatus === "yangi" || rawStatus === "new" || rawStatus === "queue";

    return `
          <div class="order-card">
            <div class="order-images">${imagesHtml}</div>
            <div class="order-info">
              <h3>📦 ${t("order")} #${order.orderNumber} | 🍽 ${t("table")} ${order.table}</h3>
              ${order.clientPhone ? `<p>📞 ${t("client_label")}: <b>${order.clientPhone}</b> <span style="color:green; font-size:12px;">(${order.clientVisits || 1} ${t("visit_suffix")})</span></p>` : ""}
              
              <p>💰 ${t("base_price")}: <b>${Number(order.originalTotal || 0).toLocaleString()} ${t("currency")}</b></p>
              
              ${order.priority === 'fast' ? `
                <p style="color:#dc3545; margin:5px 0;">⚡ ${t("fast_service_fee")}: <b>+${Number(order.fastFeeAmount || 0).toLocaleString()} ${t("currency")}</b></p>
              ` : ""}
              
              ${Number(order.discountAmount || 0) > 0 ? `
                <p style="color:#28a745; margin:5px 0;">🎁 ${t("discount")}: <b>-${Number(order.discountAmount).toLocaleString()} ${t("currency")}</b></p>
              ` : ""}
              
              <p style="font-size:16px; font-weight:bold; border-top:1px dashed #ccc; padding-top:5px; margin-top:5px;">${t("total_payment")}: ${total.toLocaleString()} ${t("currency")}</p>
              
              <p>💳 ${t("payment_method")}: <b>${paymentText}</b></p>
              <p>📌 ${t("order_status")}: <span class="status status-${cssStatusKey} ${isNew ? "new-order" : ""}">${statusText}</span></p>
            </div>
            <div class="order-actions">
              ${order.payment?.paid ? `<span class="approved">✔ ${t("status_paid")}</span>` : order.payment?.requested ? `<button onclick="approvePayment('${id}')">${t("approve")}</button>` : ""}
              <button class="btn danger" onclick="closeTable('${id}', ${order.table})">🟢 ${t("close_table_btn")}</button>
            </div>
          </div>
        `;
  } catch (e) {
    console.error("renderOrderCard xatosi:", e);
    return `<div class="order-card"><p style="color:red;">${t("error_rendering_order_card")}</p></div>`;
  }
}

window.closeTable = async (orderId, tableNumber) => {
  try {
    await update(ref(db, "tables/" + tableNumber), {
      status: "free",
      orderId: null,
      busy: false,
      closedByAdmin: true
    });

    await update(ref(db, "orders/" + orderId), {
      tableClosed: true,
      status: "closed",
      statusKey: "closed",
      statusLabel: "closed"
    });

    await window.createOrderTimelineEvent(orderId, "table_closed", {
      tableNumber,
      closedByAdmin: true
    });

    await crmAdvAudit(
      "tables",
      "close",
      String(tableNumber),
      t("audit_table_closed_admin"),
      { orderId, tableNumber },
      "info"
    );

    showAdminNotification(t("alerts.table_closed"));
  } catch (err) {
    console.error(err);
    showAdminNotification(t("notify.error"), "error");
  }
};

addMenuBtn?.addEventListener("click", async () => {
  const nameUz = foodNameInput.value.trim();
  const price = Number(addPrice.value);
  const category = categorySelect.value;
  const subcategory = subcategorySelect.value;
  const prepTime = Number(document.getElementById("addPrepTime")?.value || 30); // 🔴 YANGI
  const file = addImgInput?.files?.[0];

  if (!nameUz || price <= 0 || !category || !subcategory) {
    alert(t("alerts.fill_all")); return;
  }

  const id = Date.now().toString();
  try {
    let imgUrl = "img/no-image.png";
    let imgPath = "";

    if (file) {
      imgPath = `menu/${id}_${file.name}`;
      const imgRef = storageRef(storage, imgPath);
      await uploadBytes(imgRef, file);
      imgUrl = await getDownloadURL(imgRef);
    }

    const nameRu = await autoTranslate(nameUz, "ru");
    const nameEn = await autoTranslate(nameUz, "en");

    await set(ref(db, "menu/" + id), {
      name: { uz: nameUz, ru: nameRu, en: nameEn },
      price, category, subcategory, prepTime,
      imgUrl, imgPath,
      active: true, createdAt: Date.now()
    });

    showNotification(t("notify.food_added"));
    foodNameInput.value = ""; addPrice.value = ""; document.getElementById("addPrepTime").value = "";
    addImgInput.value = ""; if (addFileName) addFileName.textContent = t("file_not_selected");
  } catch (err) {
    console.error(err); alert(t("notify.error"));
  }
});

window.editMenu = async function (id) {
  editingItemId = id;
  const snap = await get(ref(db, "menu/" + id));
  if (!snap.exists()) return alert(t("alerts.not_found"));
  const item = snap.val();

  if (editName) editName.value = item.name?.[getLang()] || item.name?.uz || item.name?.ru || item.name?.en || "";
  if (editPriceInput) editPriceInput.value = item.price || "";

  const editPrepTimeEl = document.getElementById("editPrepTime");
  if (editPrepTimeEl) editPrepTimeEl.value = item.prepTime || 30;

  renderCategories(editCategory, item.category);
  renderSubcategories(editSubCategory, item.category, item.subcategory);

  oldImagePath = item.imgPath || "";
  if (editImgInput) editImgInput.value = "";
  if (editFileName) editFileName.textContent = t("file_not_selected");
  if (editModal) editModal.classList.remove("hidden");
};

window.closeEditModal = function () {
  editModal?.classList.add("hidden");
  editingItemId = null;
  oldImagePath = "";
  if (editImgInput) editImgInput.value = "";
  if (editFileName) editFileName.textContent = t("file_not_selected");
};

window.saveMenuItem = async function () {
  if (!editingItemId) return;
  const updates = {};
  const name = editName?.value.trim();
  const price = Number(editPriceInput?.value);
  const prepTime = Number(document.getElementById("editPrepTime")?.value || 30); // 🔴 VAQTNI OLISH
  const category = editCategory?.value;
  const subcategory = editSubCategory?.value;

  const currentSnap = await get(ref(db, "menu/" + editingItemId));
  const currentItem = currentSnap.val() || {};

  if (name) {
    const translatedRu = await autoTranslate(name, "ru");
    const translatedEn = await autoTranslate(name, "en");
    updates.name = {
      uz: name,
      ru: translatedRu || currentItem.name?.ru || "",
      en: translatedEn || currentItem.name?.en || ""
    };
  }

  if (price > 0) updates.price = price;
  if (category) updates.category = category;
  if (subcategory) updates.subcategory = subcategory;

  const file = editImgInput?.files?.[0];
  if (file) {
    try {
      if (oldImagePath && oldImagePath.startsWith("menu/")) {
        await deleteObject(storageRef(storage, oldImagePath));
      }
    } catch (e) { console.warn(t("old_image_delete_failed_log"), e); }
    const newPath = `menu/${editingItemId}_${Date.now()}_${file.name}`;
    const imgRef = storageRef(storage, newPath);
    await uploadBytes(imgRef, file);
    updates.imgUrl = await getDownloadURL(imgRef);
    updates.imgPath = newPath;
  }

  if (!Object.keys(updates).length) { alert(t("alerts.fill_all")); return; }
  await update(ref(db, "menu/" + editingItemId), updates);
  window.closeEditModal();
  await crmAdvAudit("menu", "update", editingItemId, t("audit_menu_updated"), updates, "info");
};

window.deleteMenu = async function (id) {
  if (!confirm(t("alerts.confirm_delete"))) return;
  const snap = await get(ref(db, "menu/" + id));
  if (!snap.exists()) return;
  const item = snap.val();
  undoStack = { id, item };
  await remove(ref(db, "menu/" + id));
  showUndoToast();
  undoTimer = setTimeout(async () => {
    if (undoStack?.id === id) {
      if (item.imgPath) await deleteObject(storageRef(storage, item.imgPath)).catch(() => { });
      undoStack = null;
    }
  }, 5000);
};

function showUndoToast() {
  const toast = document.createElement("div");
  toast.className = "undo-toast";
  toast.innerHTML = `<span>${t("deleted")}</span><button id="undoBtn">♻️ ${t("undo")}</button>`;
  document.body.appendChild(toast);
  document.getElementById("undoBtn").onclick = async () => {
    if (!undoStack) return;
    clearTimeout(undoTimer);
    await set(ref(db, "menu/" + undoStack.id), undoStack.item);
    undoStack = null;
    toast.remove();
    showAdminNotification(t("undo_success"));
  };
  setTimeout(() => toast.remove(), 5000);
}

window.clearAllOrders = async function () {
  if (!confirm(t("confirm_delete_orders_full"))) return;
  const tablesSnap = await get(ref(db, "tables"));
  const updates = { orders: null };
  if (tablesSnap.exists()) {
    Object.keys(tablesSnap.val()).forEach(key => {
      updates["tables/" + key + "/status"] = "free";
      updates["tables/" + key + "/orderId"] = null;
    });
  }
  await update(ref(db), updates);
  showNotification(t("orders_deleted"));
};

// ─── Reports ─────────────────────────────────────────────
window.generateRangeReport = async function () {
  const snap = await get(ref(db, "orders"));
  if (!snap.exists()) { alert(t("alerts.no_data")); return; }

  const orders = Object.values(snap.val() || {});
  const dateFiltered = filterByDate(orders);
  if (!dateFiltered.length) { alert(t("alerts.no_data")); return; }

  const reportOrders = filterByPayment(dateFiltered);
  if (!reportOrders.length) { alert(t("alerts.no_data")); return; }

  let totalSum = 0;
  reportOrders.forEach(o => { totalSum += Number(o.total || 0); });

  const reportResult = document.getElementById("reportResult");
  if (reportResult) reportResult.innerHTML = `💰 <b>${t("total_sum")}: ${totalSum.toLocaleString()} ${t("currency")}</b>`;

  renderStatusChart(reportOrders.reduce((acc, o) => {
    const key = String(o.status || o.statusKey || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {}));

  const { cashSum, paymeSum, clickSum } = calculatePayments(reportOrders);
  const paymentSummary = document.getElementById("paymentSummary");
  if (paymentSummary) {
    paymentSummary.innerHTML = `
        💵 ${t("payment_cash")}: <b>${cashSum.toLocaleString()} ${t("currency")}</b><br>
        📲 ${t("payment_payme")}: <b>${paymeSum.toLocaleString()} ${t("currency")}</b><br>
        🔵 ${t("payment_click")}: <b>${clickSum.toLocaleString()} ${t("currency")}</b>
      `;
  }

  renderTopFoodsChart(reportOrders);
  renderTopFoodsTable(reportOrders);
  renderCategorySales(reportOrders);
  renderOrdersChart(reportOrders.length);
};

function calculateCategorySales(orders) {
  const stats = {};
  orders.forEach(order => {
    if (!order.items) return;
    Object.entries(order.items).forEach(([itemId, item]) => {
      const menuId = item.menuId || item.id || item.itemId || itemId;
      const menuItem = window.allMenu?.[menuId];
      const qty = Number(item.qty || 0);
      const sum = Number(item.price || 0) * qty;
      const cat = menuItem?.category || "unknown";
      if (!stats[cat]) stats[cat] = { qty: 0, sum: 0 };
      stats[cat].qty += qty;
      stats[cat].sum += sum;
    });
  });
  return stats;
}

function renderCategorySales(orders) {
  const tbody = document.getElementById("categorySalesTable");
  if (!tbody) return;
  const stats = calculateCategorySales(orders);
  tbody.innerHTML = "";
  Object.entries(stats).forEach(([catId, v]) => {
    const catObj = CATEGORY_DATA.categories.find(c => c.id === catId);
    const name = catObj ? t(catObj.nameKey) : catId;
    tbody.innerHTML += `<tr><td>${name}</td><td>${v.qty}</td><td>${v.sum.toLocaleString()} ${t("currency")}</td></tr>`;
  });
}

window.downloadChartPNG = function (canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = canvasId + ".png";
  link.click();
};

window.downloadChartPDF = function (canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const imgData = canvas.toDataURL("image/png", 1.0);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("landscape");
  const imgWidth = 280;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  pdf.addImage(imgData, "PNG", 10, 10, imgWidth, imgHeight);
  pdf.save(canvasId + ".pdf");
};

function renderOrdersChart(count) {
  const ctx = document.getElementById("ordersChart");
  if (!ctx) return;
  if (ordersChart) ordersChart.destroy();
  ordersChart = new Chart(ctx, {
    type: "bar",
    data: { labels: [t("orders_list")], datasets: [{ label: t("orders_list"), data: [count] }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function renderStatusChart(statusCount) {
  const ctx = document.getElementById("statusChart");
  if (!ctx) return;
  if (statusChart) statusChart.destroy();
  statusChart = new Chart(ctx, {
    type: "pie",
    data: {
      labels: Object.keys(statusCount).map(k => t("status_" + k.toLowerCase())),
      datasets: [{ data: Object.values(statusCount) }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

window.downloadCSV = async function () {
  const snap = await get(ref(db, "orders"));
  if (!snap.exists()) { alert(t("alerts.no_data")); return; }
  const orders = Object.values(snap.val());
  const lang = getLang();
  const locale = lang === "ru" ? "ru-RU" : lang === "en" ? "en-GB" : "uz-UZ";
  let csv = "\uFEFF" + `${t("report_date")};${t("table")};${t("total_sum")};${t("order_status")}\n`;
  orders.forEach(o => {
    const date = o.createdAt ? new Date(o.createdAt).toLocaleDateString(locale) : "";
    const rawStatus = String(o.status || "").toLowerCase();
    const statusKey = "status_" + rawStatus;
    const statusText = t(statusKey) !== statusKey ? t(statusKey) : o.status;
    csv += `${date};${o.table || ""};${Number(o.total || 0).toLocaleString(locale)};${statusText}\n`;
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  link.download = t("report_title") + ".csv";
  link.click();
};

window.downloadExcel = async function () {
  const snap = await get(ref(db, "orders"));
  if (!snap.exists()) { alert(t("alerts.no_data")); return; }
  const rawOrders = Object.values(snap.val());
  const lang = getLang();
  const locale = lang === "ru" ? "ru-RU" : lang === "en" ? "en-GB" : "uz-UZ";
  const dateLabel = t("report_date"), tableLabel = t("table"),
    totalLabel = t("total_sum"), statusLabel = t("order_status");
  const orders = rawOrders.map(o => {
    const rawStatus = String(o.status || "").toLowerCase();
    const statusKey = "status_" + rawStatus;
    return {
      [dateLabel]: o.createdAt ? new Date(o.createdAt).toLocaleDateString(locale) : "",
      [tableLabel]: o.table || "",
      [totalLabel]: Number(o.total || 0),
      [statusLabel]: t(statusKey) !== statusKey ? t(statusKey) : o.status
    };
  });
  const ws = XLSX.utils.json_to_sheet(orders);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, tr("report_title", tr("report_default_title", "Report")));
  XLSX.writeFile(wb, (tr("report_title", tr("report_default_title", "Report"))) + ".xlsx");
};

function calculateTopFoods(orders) {
  const stats = {};
  orders.forEach(order => {
    if (!order.items) return;
    Object.values(order.items).forEach(item => {
      const name = typeof item.name === "object"
        ? item.name?.[getLang()] || item.name?.uz || item.name?.ru || item.name?.en || uiEmpty()
        : item.name || uiEmpty();
      const qty = Number(item.qty || 0);
      const sum = Number(item.price || 0) * qty;
      if (!stats[name]) stats[name] = { name, qty: 0, sum: 0 };
      stats[name].qty += qty;
      stats[name].sum += sum;
    });
  });
  return Object.values(stats).sort((a, b) => b.qty - a.qty).slice(0, 10);
}

function renderTopFoodsChart(orders) {
  const ctx = document.getElementById("topFoodsChart");
  if (!ctx) return;
  if (topFoodsChart) topFoodsChart.destroy();
  const topFoods = calculateTopFoods(orders);
  if (!topFoods.length) return;
  topFoodsChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: topFoods.map(i => i.name),
      datasets: [{ label: t("top_foods"), data: topFoods.map(i => i.qty) }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function renderTopFoodsTable(orders) {
  const tbody = document.getElementById("topFoodsTable");
  if (!tbody) return;
  tbody.innerHTML = "";
  calculateTopFoods(orders).forEach((item, i) => {
    tbody.innerHTML += `<tr><td>${i + 1}</td><td>${item.name}</td><td>${item.qty}</td><td>${item.sum.toLocaleString()} ${t("currency")}</td></tr>`;
  });
}

window.refreshReports = async function () {
  if (ordersChart) ordersChart.destroy();
  if (statusChart) statusChart.destroy();
  if (topFoodsChart) topFoodsChart.destroy();
  ordersChart = statusChart = topFoodsChart = null;
  await window.generateRangeReport();
  showAdminNotification(t("updated"), "success");
};

// ─── Payment helpers ─────────────────────────────────────
function normalizePaymentMethod(method = "") {
  const m = String(method || "").trim().toLowerCase();
  if (m === "cash") return "cash";
  if (m === "payme") return "payme";
  if (m === "click" || m === "card") return "click";
  return "";
}

function filterByPayment(orders) {
  const cashChecked = document.getElementById("filterCash")?.checked ?? true;
  const paymeChecked = document.getElementById("filterPayme")?.checked ?? true;
  const clickChecked = document.getElementById("filterClick")?.checked ?? true;
  const paidOnly = document.getElementById("filterPaidOnly")?.checked ?? false;

  return orders.filter(order => {
    if (!order.payment) return false;
    const method = normalizePaymentMethod(order.payment.method);
    const isPaid = order.payment.paid === true;
    if (paidOnly && !isPaid) return false;
    if (!cashChecked && !paymeChecked && !clickChecked) return false;
    if (method === "cash") return cashChecked;
    if (method === "payme") return paymeChecked;
    if (method === "click") return clickChecked;
    return false;
  });
}

function calculatePayments(orders) {
  let cashSum = 0, paymeSum = 0, clickSum = 0;
  orders.forEach(o => {
    const sum = Number(o.total || 0);
    const method = normalizePaymentMethod(o.payment?.method);
    if (method === "cash") cashSum += sum;
    if (method === "payme") paymeSum += sum;
    if (method === "click") clickSum += sum;
  });
  return { cashSum, paymeSum, clickSum };
}

function filterByDate(orders) {
  const mode = document.getElementById("dateMode")?.value;
  const fromInput = document.getElementById("reportFrom")?.value;
  const toInput = document.getElementById("reportTo")?.value;
  const today = new Date();
  let fromDate, toDate;

  if (mode === "day") {
    fromDate = new Date(today.setHours(0, 0, 0, 0));
    toDate = new Date(today.setHours(23, 59, 59, 999));
  } else if (mode === "month") {
    fromDate = new Date(today.getFullYear(), today.getMonth(), 1);
    toDate = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
  } else if (mode === "range") {
    if (!fromInput || !toInput) return [];
    fromDate = new Date(fromInput);
    toDate = new Date(toInput);
    toDate.setHours(23, 59, 59, 999);
  } else {
    return orders;
  }

  return orders.filter(o => {
    const time = o.createdAt || o.date;
    if (!time) return false;
    const d = new Date(time);
    return d >= fromDate && d <= toDate;
  });
}

// FIX 7: filterPaidOnly endi HTMLda bor, listenerlar ishlaydi
["filterCash", "filterPayme", "filterClick", "filterPaidOnly"].forEach(id => {
  document.getElementById(id)?.addEventListener("change", window.generateRangeReport);
});

// ─── Menu list ───────────────────────────────────────────
function renderMenu() {
  if (!menuList) return;
  const lang = getLang();
  let items = Object.entries(window.allMenu || {})
    .map(([id, item]) => ({ id, ...item }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (searchQuery) {
    items = items.filter(item => {
      const name = item.name?.[lang] || item.name?.uz || item.name?.ru || item.name?.en || "";
      return name.toLowerCase().includes(searchQuery.toLowerCase());
    });
  }

  menuList.innerHTML = items.length
    ? items.map(item => {
      const name = item.name?.[lang] || item.name?.uz || item.name?.ru || item.name?.en || uiEmpty();
      const categoryObj = CATEGORY_DATA?.categories?.find(c => c.id === item.category);
      const catName = categoryObj ? t(categoryObj.nameKey) : item.category || uiEmpty();
      const subName = item.subcategory ? t(item.subcategory) : uiEmpty();
      const img = item.imgUrl?.trim() ? item.imgUrl : "img/no-image.png";
      return `
            <div class="menu-card">
              <label class="menu-select">
                <input type="checkbox" class="menu-check" value="${item.id}">
                <span></span>
              </label>
              <div class="menu-img"><img src="${img}" alt="${name}" onerror="this.src='img/no-image.png'"></div>
              <div class="menu-info">
                <h4>${name}</h4>
                <p class="menu-cat">📂 ${catName} / ${subName}</p>
                <p class="menu-price">💰 ${item.price.toLocaleString()} ${t("currency")}</p>
              </div>
              <div class="menu-actions">
                <button class="edit-btn"   data-id="${item.id}">✏️</button>
                <button class="delete-btn" data-id="${item.id}">🗑</button>
              </div>
            </div>
          `;
    }).join("")
    : `<p>${t("search_not_found")}</p>`;
}

window.deleteSelectedMenus = async function () {
  const checks = document.querySelectorAll(".menu-check:checked");
  if (!checks.length) { alert(t("confirm_select_first")); return; }
  if (!confirm(t("confirm_delete_selected"))) return;
  for (const ch of checks) {
    const snap = await get(ref(db, "menu/" + ch.value));
    if (snap.exists() && snap.val().imgPath) {
      await deleteObject(storageRef(storage, snap.val().imgPath)).catch(() => { });
    }
    await remove(ref(db, "menu/" + ch.value));
  }
  showAdminNotification(t("notify_deleted_selected"));
};

window.deleteAllMenus = async function () {
  if (!confirm(t("confirm_delete_all_1"))) return;
  if (!confirm(t("confirm_delete_all_2"))) return;
  const snap = await get(ref(db, "menu"));
  if (!snap.exists()) return;
  const data = snap.val();
  for (const id in data) {
    if (data[id].imgPath) await deleteObject(storageRef(storage, data[id].imgPath)).catch(() => { });
  }
  await remove(ref(db, "menu"));
  showAdminNotification(t("notify_deleted_all"), "error");
};

function listenMenu() {
  onValue(ref(db, "menu"), snap => {
    window.allMenu = snap.val() || {};
    renderMenu();
  });
}

window.toggleMenu = async function (id, active) {
  await update(ref(db, "menu/" + id), { active });
};

document.getElementById("menuSearch")?.addEventListener("input", e => {
  searchQuery = e.target.value.toLowerCase();
  renderMenu();
});

document.addEventListener("click", e => {
  if (e.target.classList.contains("edit-btn")) editMenu(e.target.dataset.id);
  if (e.target.classList.contains("delete-btn")) deleteMenu(e.target.dataset.id);
});


let cashierListenerBound = false;

function ensureCashierListener() {
  if (cashierListenerBound) return;
  cashierListenerBound = true;
  listenCashier();
}

function listenCashier() {
  onValue(ref(db, "orders"), snap => {
    const orders = snap.val() || {};
    const list = document.getElementById("cashierList");
    if (!list) return;
    list.innerHTML = "";

    Object.entries(orders)
      .filter(([_, o]) => o.payment?.requested && !o.payment?.paid)
      .sort((a, b) => {
        const ta = a[1].payment?.requestedAt || a[1].updatedAt || a[1].createdAt || 0;
        const tb = b[1].payment?.requestedAt || b[1].updatedAt || b[1].createdAt || 0;
        return tb - ta;
      })
      .forEach(([id, o]) => {
        list.innerHTML += `
            <div class="cash-card">
              <h4>🧾 ${o.orderNumber}</h4>
              <p>${t("table")}: <b>${o.table}</b></p>
              <div class="cash-items">
                ${Object.values(o.items || {}).map(i => {
          const menuItem = window.allMenu?.[i.id || i.menuId || i.itemId];
          const itemName = getTranslatedItemName(i, menuItem, getLang());
          return `<div class="cash-item">
                    <img src="${i.img || 'img/food.png'}" alt="${t("order_image_alt")}">
                    <span>${itemName} × ${i.qty}</span>
                    <b>${(i.price * i.qty).toLocaleString()} ${t("currency")}</b>
                  </div>`;
        }).join("")}
              </div>
              <p class="cash-total">${t("total_label")}: <b>${o.total.toLocaleString()} ${t("currency")}</b></p>
              <button class="btn primary" onclick="approvePayment('${id}')">✅ ${t("approve")}</button>
            </div>
          `;
      });
  });
}

window.approvePayment = async function (orderId) {
  const now = Date.now();
  const orderSnap = await get(ref(db, "orders/" + orderId));
  if (!orderSnap.exists()) return;

  const usersSnap = await get(ref(db, "users"));
  const users = usersSnap.val() || {};

  let selectedChef = document.getElementById("chefFilter")?.value || "all";

  if (!selectedChef || selectedChef === "all") {
    const activeChefs = Object.entries(users)
      .filter(([_, u]) => u.role === "chef" && u.active !== false)
      .map(([id, u]) => ({ id, ...u }));

    if (!activeChefs.length) { alert(t("active_chef_not_found")); return; }

    const ordersSnap = await get(ref(db, "orders"));
    const allOrdersNow = ordersSnap.val() || {};

    let minCount = Infinity, bestChefId = activeChefs[0].id;
    activeChefs.forEach(chef => {
      const count = Object.values(allOrdersNow).filter(o => {
        const s = String(o.status || o.statusKey || "").toLowerCase().trim();
        return String(o.chefId || "") === chef.id && (
          s === "tasdiqlandi" ||
          s === "approved" ||
          s === "tayyorlanmoqda" ||
          s === "cooking"
        );
      }).length;
      if (count < minCount) { minCount = count; bestChefId = chef.id; }
    });
    selectedChef = bestChefId;
  }

  const updates = {
    [`orders/${orderId}/approved`]: true,
    [`orders/${orderId}/payment/paid`]: true,
    [`orders/${orderId}/payment/approved`]: true,
    [`orders/${orderId}/payment/requested`]: false,
    [`orders/${orderId}/payment/rejected`]: false,
    [`orders/${orderId}/payment/approvedAt`]: now,
    [`orders/${orderId}/status`]: "approved",
    [`orders/${orderId}/statusKey`]: "approved",
    [`orders/${orderId}/statusLabel`]: "approved",
    [`orders/${orderId}/updatedAt`]: now,
    [`orders/${orderId}/chefId`]: selectedChef
  };

  await update(ref(db), updates);
  await window.createOrderTimelineEvent(orderId, "payment_approved", {
    approvedAt: now,
    chefId: selectedChef
  });

  const refreshedOrderSnap = await get(ref(db, `orders/${orderId}`));
  const refreshedOrder = refreshedOrderSnap.exists() ? refreshedOrderSnap.val() : null;

  if (refreshedOrder) {
    const mergedOrders = {
      ...(window.allOrders || {}),
      [orderId]: refreshedOrder
    };

    await syncCustomerProfileFromOrder(orderId, refreshedOrder, mergedOrders);
  }

  await crmAdvAudit(
    "orders",
    "payment_approve",
    orderId,
    t("audit_payment_approved_admin"),
    { approvedAt: now, chefId: selectedChef },
    "info"
  );
  showAdminNotification(t("alerts.payment_approved"));
};

function loadSectionData(id) {
  if (id === "crm") loadCRM();
  if (id === "reservations") loadReservations();
  if (id === "feedback") loadFeedbacks();
  if (id === "notifications") loadNotifications();
  if (id === "roles") loadRoles();
  if (id === "audit-log") loadAuditLog();
  if (id === "settings") loadSettings();
  if (id === "tables") loadTablesAdvanced();
  if (id === "cashier") ensureCashierListener();
}

/* ======================
   BO'LIMLARNI KO'RSATISH 
=========================*/
function showSection(id) {
  const sections = document.querySelectorAll("main section, main .admin-section, .dashboard-section");
  const navLinks = document.querySelectorAll(".sidebar-nav a, .nav-link");

  let found = false;

  sections.forEach(sec => {
    const isActive = sec.id === id;

    if (isActive) {
      sec.style.display = "block";
      sec.classList.add("active-section");
      found = true;
    } else {
      sec.style.display = "none";
      sec.classList.remove("active-section");
    }
  });

  navLinks.forEach(a => {
    if (a.getAttribute("href") === "#" + id || a.getAttribute("href") === id) {
      a.classList.add("active");
    } else {
      a.classList.remove("active");
    }
  });

  if (found) loadSectionData(id);
}

document.querySelectorAll(".sidebar-nav a, .nav-link").forEach(link => {
  link.addEventListener("click", e => {
    e.preventDefault();
    showSection(link.getAttribute("href").replace("#", ""));
  });
});

function listenPaymentNotifications() {
  onValue(ref(db, "orders"), snap => {
    const orders = snap.val() || {};

    Object.entries(orders).forEach(([orderId, o]) => {
      if (o.payment?.paid && !o.payment?.adminNotified) {
        showAdminNotification(
          `💰 ${t("table")} ${o.table} — ${Number(o.total || 0).toLocaleString()} ${t("currency")}`
        );

        update(ref(db, "orders/" + orderId + "/payment"), {
          adminNotified: true
        });
      }
    });
  });
}

window.deleteAllOrdersAndFreeTables = async function () {
  if (!confirm(t("alerts.confirm_delete_all_orders_1"))) return;
  if (!confirm(t("alerts.confirm_delete_all_orders_2"))) return;
  try {
    await set(ref(db, "orders"), null);
    const tablesSnap = await get(ref(db, "tables"));
    if (tablesSnap.exists()) {
      const updates = {};
      Object.keys(tablesSnap.val()).forEach(n => {
        updates[`tables/${n}/busy`] = false;
        updates[`tables/${n}/orderId`] = null;
        updates[`tables/${n}/status`] = "free";
        updates[`tables/${n}/closedByAdmin`] = false;
      });
      await update(ref(db), updates);
    }
    window.allOrders = {};
    renderOrders({});
    showAdminNotification(t("alerts.orders_deleted_all"), "error");
  } catch (e) {
    console.error(e);
    showAdminNotification(t("notify.error"), "error");
  }
};

function renderOrderFilters() {
  const payment = document.getElementById("filterPaymentStatus");
  const category = document.getElementById("filterOrderCategory");
  const subcategory = document.getElementById("filterOrderSubcategory");

  if (payment) {
    payment.innerHTML = `
    <option value="all">${t("orders_payment_all")}</option>
    <option value="paid">${t("orders_payment_paid")}</option>
    <option value="unpaid">${t("orders_payment_unpaid")}</option>
  `;
  }
  if (category) {
    category.innerHTML = `<option value="all">${t("all_categories")}</option>`;
    CATEGORY_DATA.categories.forEach(cat => {
      category.innerHTML += `<option value="${cat.id}">${t(cat.nameKey)}</option>`;
    });
  }
  if (subcategory) {
    subcategory.innerHTML = `<option value="all">${t("all_subcategories")}</option>`;
  }
}

window.addChef = async function () {
  const name = document.getElementById("chefName")?.value?.trim();
  const passwordInput = document.getElementById("chefPassword")?.value?.trim();

  if (!name) {
    alert(t("enter_chef_name"));
    return;
  }

  const password = passwordInput || String(Math.floor(1000 + Math.random() * 9000));
  const id = "chef_" + Date.now();

  try {
    await set(ref(db, "users/" + id), {
      name,
      role: "chef",
      active: true,
      password,
      createdAt: Date.now()
    });

    showAdminNotification(
      `👨‍🍳 ${t("chef_added")}\n${t("name_label")}: ${name}\n${t("password_label")}: ${password}\n(${t("save_password_note")})`,
      "success"
    );

    document.getElementById("chefName").value = "";
    document.getElementById("chefPassword").value = "";
  } catch (err) {
    console.error(err);
    showAdminNotification(t("error_occurred"), "error");
  }
};

window.addWaiter = async function () {
  const name = document.getElementById("waiterName")?.value?.trim();
  if (!name) return;
  await update(ref(db, "users/waiter_" + Date.now()), { name, role: "waiter", active: true, createdAt: Date.now() });
  document.getElementById("waiterName").value = "";
  showAdminNotification(t("waiter_added_full"));
};

window.showStaffTab = function (type) {
  document.getElementById("chefTab").style.display = type === "chef" ? "block" : "none";
  document.getElementById("waiterTab").style.display = type === "waiter" ? "block" : "none";

  const buttons = document.querySelectorAll(".staff-tabs .tab-btn");
  buttons.forEach(btn => btn.classList.remove("active"));

  if (type === "chef") buttons[0]?.classList.add("active");
  if (type === "waiter") buttons[1]?.classList.add("active");
};

window.toggleStaff = async function (id, active) {
  await update(ref(db, "users/" + id), { active });
  showAdminNotification(
    active ? t("staff_active_full") : t("staff_inactive_full")
  );
};

window.editStaff = async function (id, name) {
  const newName = prompt(t("enter_new_name"), name);
  if (!newName) return;
  await update(ref(db, "users/" + id), { name: newName });
  showAdminNotification(t("name_updated_full"));
};

window.deleteStaff = async function (id) {
  if (!confirm(t("confirm_delete_staff"))) return;
  await remove(ref(db, "users/" + id));
  showAdminNotification(t("staff_deleted_full"));
};

document.getElementById("chefFilter")?.addEventListener("change", () => renderOrders(window.allOrders));

function applyChefFilter(orders) {
  const chef = document.getElementById("chefFilter")?.value;
  if (!chef || chef === "all") return orders;
  return orders.filter(([_, o]) => o.chefId === chef);
}

function fillChefFilter(users) {
  const select = document.getElementById("chefFilter");
  if (!select) return;

  const prev = select.value || "all";

  select.innerHTML = `<option value="all">${t("all_items")}</option>`;

  Object.entries(users || {}).forEach(([id, u]) => {
    if (u.role !== "chef") return;
    select.innerHTML += `<option value="${id}">${u.name}</option>`;
  });

  const exists = [...select.options].some(opt => opt.value === prev);
  select.value = exists ? prev : "all";
}

function calculateChefStats(orders) {
  const stats = {};
  Object.values(orders || {}).forEach(o => {
    if (!o.chefId) return;
    if (!stats[o.chefId]) stats[o.chefId] = { count: 0, totalTime: 0 };
    const s = String(o.status || o.statusKey || "").toLowerCase();
    if (s === "tayyor" || s === "ready") {
      stats[o.chefId].count++;
      if (o.updatedAt && o.createdAt) stats[o.chefId].totalTime += (o.updatedAt - o.createdAt) / 60000;
    }
  });
  return stats;
}

function renderStaff(users) {
  const chefList = document.getElementById("chefList");
  const waiterList = document.getElementById("waiterList");
  if (!chefList || !waiterList) return;
  chefList.innerHTML = "";
  waiterList.innerHTML = "";
  const chefStats = calculateChefStats(window.allOrders);

  Object.entries(users).forEach(([id, u]) => {
    if (u.role === "chef") {
      const stat = chefStats[id] || { count: 0, totalTime: 0 };
      const avg = stat.count ? (stat.totalTime / stat.count).toFixed(1) : 0;
      chefList.innerHTML += `
          <div class="staff-card ${u.active ? "" : "staff-off"}">
            <h3>👨‍🍳 ${u.name} <span onclick="openStaffStats('${id}','chef')" class="stats-icon">📊</span></h3>
            <p>🍽 ${t("orders_count")}: ${stat.count}</p>
            <p>⏱ ${t("avg_time")}: ${avg} ${t("minute_short")}</p>
            <div class="staff-actions">
              <label class="switch" onclick="event.stopPropagation()">
                <input type="checkbox" ${u.active ? "checked" : ""} onchange="toggleStaff('${id}',this.checked)">
                <span class="slider"></span>
              </label>
              <button onclick="event.stopPropagation(); editStaff('${id}','${u.name}')">✏️</button>
              <button onclick="event.stopPropagation(); deleteStaff('${id}')">🗑</button>
            </div>
          </div>
        `;
    }
    if (u.role === "waiter") {
      const count = Object.values(window.allOrders).filter(o => o.waiterId === id).length;
      waiterList.innerHTML += `
          <div class="staff-card ${u.active ? "" : "staff-off"}">
            <h3>🧑‍🍳 ${u.name} <span onclick="openStaffStats('${id}','waiter')" class="stats-icon">📊</span></h3>
            <p>🪑 ${t("tables_served")}: ${count}</p>
            <div class="staff-actions">
              <label class="switch" onclick="event.stopPropagation()">
                <input type="checkbox" ${u.active ? "checked" : ""} onchange="toggleStaff('${id}',this.checked)">
                <span class="slider"></span>
              </label>
              <button onclick="event.stopPropagation(); editStaff('${id}','${u.name}')">✏️</button>
              <button onclick="event.stopPropagation(); deleteStaff('${id}')">🗑</button>
            </div>
          </div>
        `;
    }
  });
}

function listenStaff() {
  onValue(ref(db, "users"), snap => {
    const users = snap.val() || {};
    window.allUsers = users;

    renderStaff(users);
    fillChefFilter(users);

    const activeChefs = Object.values(users).filter(u => u.role === "chef" && u.active).length;
    const activeWaiters = Object.values(users).filter(u => u.role === "waiter" && u.active).length;

    const chefEl = document.getElementById("activeChefsCount");
    const waiterEl = document.getElementById("activeWaitersCount");

    if (chefEl) chefEl.innerText = activeChefs;
    if (waiterEl) waiterEl.innerText = activeWaiters;
  });
}

window.openStaffStats = function (id, role) {
  currentStaffId = id;
  currentStaffRole = role;
  document.getElementById("staffStatsModal").classList.remove("hidden");
  window.loadStaffStats();
};

window.closeStaffStats = function () {
  document.getElementById("staffStatsModal").classList.add("hidden");
};

let staffOrdersChart = null;
let timeChart = null;

window.loadStaffStats = async function () {
  const period = document.getElementById("statsPeriod").value;
  const snap = await get(ref(db, "orders"));
  const orders = snap.val() || {};
  const now = new Date();
  let from = new Date();
  if (period === "today") from.setHours(0, 0, 0, 0);
  if (period === "week") from.setDate(now.getDate() - 7);
  if (period === "month") from.setMonth(now.getMonth() - 1);

  let count = 0, totalTime = 0;
  const labels = [], values = [];

  Object.values(orders).forEach(o => {
    const date = new Date(o.createdAt);
    if (date < from) return;
    if (currentStaffRole === "chef" && o.chefId === currentStaffId) {
      count++;
      if (o.updatedAt) {
        const cookTime = (o.updatedAt - o.createdAt) / 60000;
        totalTime += cookTime;
        labels.push(date.toLocaleDateString());
        values.push(cookTime);
      }
    }
    if (currentStaffRole === "waiter" && o.waiterId === currentStaffId) {
      count++;
      labels.push(date.toLocaleDateString());
      values.push(o.table);
    }
  });

  const avg = count ? (totalTime / count).toFixed(1) : 0;
  document.getElementById("staffStatsContent").innerHTML = currentStaffRole === "chef"
    ? `<p>🍽 ${t("orders_count")}: ${count}</p><p>⏱ ${t("avg_time")}: ${avg} ${t("minute_short")}</p>`
    : `<p>📦 ${t("orders_count")}: ${count}</p>`;

  const ordersCanvas = document.getElementById("staffOrdersChart");
  const timeCanvas = document.getElementById("staffTimeChart");
  if (!ordersCanvas || !timeCanvas) return;
  if (!labels.length) {
    if (staffOrdersChart) {
      staffOrdersChart.destroy();
      staffOrdersChart = null;
    }
    if (timeChart) {
      timeChart.destroy();
      timeChart = null;
    }

    const staffStatsContent = document.getElementById("staffStatsContent");
    if (staffStatsContent) {
      staffStatsContent.innerHTML += `<p style="text-align:center">${t("no_data")}</p>`;
    }
    return;
  }
  if (staffOrdersChart) staffOrdersChart.destroy();
  if (timeChart) timeChart.destroy();
  staffOrdersChart = new Chart(ordersCanvas, {
    type: "bar",
    data: { labels, datasets: [{ label: t("orders"), data: values, backgroundColor: "#f59e0b" }] }
  });
  timeChart = new Chart(timeCanvas, {
    type: "line",
    data: { labels, datasets: [{ label: t("time"), data: values, borderColor: "#3b82f6", backgroundColor: "rgba(59,130,246,0.2)", tension: 0.3 }] }
  });
};

let chartUpdateTimeout;
function debouncedChartUpdate() {
  clearTimeout(chartUpdateTimeout);
  chartUpdateTimeout = setTimeout(() => {
    const reportSection = document.getElementById("report");
    if (reportSection?.style.display !== "none") {
      window.generateRangeReport();
    }
  }, 2000);
}

function listenOrders() {
  onValue(ref(db, "orders"), async snap => {
    window.allOrders = snap.val() || {};

    for (const [orderId, order] of Object.entries(window.allOrders)) {
      const phone = normalizePhone(
        order.customerPhone ||
        order.phone ||
        order.clientPhone ||
        ""
      );

      if (!phone) continue;
      if (order.payment?.paid) continue;
      if (order.loyaltyAutoApplied === true) continue;
      if (loyaltySyncInFlight.has(orderId)) continue;

      loyaltySyncInFlight.add(orderId);

      try {
        await applyAutoLoyaltyToOrder(orderId, order, window.allOrders);
      } catch (err) {
        console.error("Auto loyalty apply error:", err);
      } finally {
        loyaltySyncInFlight.delete(orderId);
      }
    }

    renderOrders(window.allOrders);
    updateRealTimeStats();

    if (ordersChart || statusChart || topFoodsChart) {
      debouncedChartUpdate();
    }
  });
}

function listenTablesRealtime() {
  onValue(ref(db, "tables"), snap => {
    const tables = snap.val() || {};
    let busyTables = 0, freeTables = 0;
    Object.values(tables).forEach(table => {
      if (table.status === "open" || table.busy) busyTables++;
      else freeTables++;
    });
    const busyEl = document.getElementById("busyTablesCount");
    const freeEl = document.getElementById("freeTablesCount");
    if (busyEl) { busyEl.innerText = busyTables; busyEl.classList.add("pulse"); setTimeout(() => busyEl.classList.remove("pulse"), 1000); }
    if (freeEl) freeEl.innerText = freeTables;

    const tablesSection = document.getElementById("tables");
    if (tablesSection?.style.display !== "none") loadTablesAdvanced();
  });
}

function updateRealTimeStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let todayOrders = 0, activeOrders = 0, todayRevenue = 0;

  Object.values(window.allOrders || {}).forEach(order => {
    const orderDate = new Date(order.createdAt);
    if (orderDate >= today) {
      todayOrders++;
      if (order.payment?.paid) todayRevenue += Number(order.total || 0);
    }
    const s = String(order.status || "").toLowerCase();
    if (
      s === "tasdiqlandi" ||
      s === "approved" ||
      s === "tayyorlanmoqda" ||
      s === "cooking"
    ) activeOrders++;
  });

  const totalEl = document.getElementById("totalOrdersToday");
  const activeEl = document.getElementById("activeOrders");
  const revenueEl = document.getElementById("totalRevenue");

  if (totalEl) { totalEl.innerText = todayOrders; totalEl.classList.add("pulse"); setTimeout(() => totalEl.classList.remove("pulse"), 1000); }
  if (activeEl) activeEl.innerText = activeOrders;
  if (revenueEl) revenueEl.innerText = todayRevenue.toLocaleString() + " " + t("currency");
}

// ─── CRM ─────────────────────────────────────────────────
async function loadCRM() {
  const statsEl = document.getElementById("crmStats");
  const listEl = document.getElementById("customerList");
  if (!statsEl || !listEl) return;
  try {
    const [ordersSnap, customersSnap, usersSnap] = await Promise.all([
      get(ref(db, "orders")), get(ref(db, "customers")), get(ref(db, "users"))
    ]);
    crmState.customers = buildCustomerMapFromOrders(
      ordersSnap.val() || {}, customersSnap.val() || {}, usersSnap.val() || {}
    );
    crmState.filtered = [...crmState.customers];
    renderCRMStats();
    renderCustomerList();
    const searchInput = document.getElementById("customerSearch");
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.dataset.bound = "1";
      searchInput.addEventListener("input", filterCustomers);
    }
  } catch (err) {
    console.error(t("crm_load_error_log"), err);
    showAdminNotification(t("crm_load_error"), "error");
  }
}

const loyaltySyncInFlight = new Set();

/* =========================
   MIJOZ TASHRIFLARINI SANASH 
========================= */
async function applyAutoLoyaltyToOrder(orderId, order, ordersObj = {}) {
  const phone = normalizePhone(order.customerPhone || order.phone || order.clientPhone || "");
  if (!phone) return;
  if (order.payment?.paid) return;

  const previousVisits = countCustomerVisitsByPhone(phone, ordersObj, orderId);
  const currentVisitNumber = previousVisits + 1;
  const loyaltyLevel = getLoyaltyLevel(0, currentVisitNumber);

  const customerName = order.customerName || order.clientName || order.name || `${t("table")} ${order.table || uiEmpty()}`;

  await update(ref(db, `orders/${orderId}`), {
    customerId: phone,
    customerPhone: phone,
    customerName,
    loyaltyLevel,
    loyaltyVisits: currentVisitNumber,
    loyaltyAutoApplied: true,
    updatedAt: Date.now()
  });
}

async function syncCustomerProfileFromOrder(orderId, order, ordersObj = {}) {
  const phone = normalizePhone(
    order.customerPhone ||
    order.phone ||
    order.clientPhone ||
    ""
  );

  if (!phone) return;

  const paidVisits = countCustomerVisitsByPhone(phone, ordersObj);
  const loyaltyLevel = getLoyaltyLevel(0, paidVisits);
  const discountPercent = getLoyaltyDiscountPercent(paidVisits);
  const totalSpent = sumCustomerPaidTotalByPhone(phone, ordersObj);

  await update(ref(db, `customers/${crmAdvSafeKey(phone)}`), {
    id: phone,
    phone,
    name: order.customerName || order.clientName || order.name || "",
    visits: paidVisits,
    loyalty: loyaltyLevel,
    loyaltyDiscountPercent: discountPercent,
    cashbackBalance: Number(order.cashbackBalance || 0),
    totalSpent,
    lastVisit: Date.now(),
    updatedAt: Date.now()
  });
}

function renderCRMStats() {
  const el = document.getElementById("crmStats");
  if (!el) return;
  const customers = Array.isArray(crmState.filtered) ? crmState.filtered : crmState.customers;
  const totalCustomers = customers.length;
  const vipMembers = customers.filter(c => c.loyalty === "vip").length;
  const returning = customers.filter(c => c.visits > 1).length;
  const avgSpend = totalCustomers
    ? customers.reduce((sum, c) => sum + Number(c.totalSpent || 0), 0) / totalCustomers : 0;
  const topVip = [...crmState.customers]
    .filter(c => c.loyalty === "vip").slice(0, 3)
    .map(c => `${escapeHtml(c.name)} (${formatMoney(c.totalSpent)})`).join("<br>") || uiEmpty();
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><h4>${t("crm_total_customers")}</h4><b>${totalCustomers}</b></div>
      <div class="stat-card"><h4>${t("crm_vip_customers")}</h4><b>${vipMembers}</b></div>
      <div class="stat-card"><h4>${t("crm_returning_customers")}</h4><b>${returning}</b></div>
      <div class="stat-card"><h4>${t("crm_avg_spend")}</h4><b>${formatMoney(avgSpend)}</b></div>
      <div class="stat-card wide"><h4>${t("crm_vip_insight")}</h4><div>${topVip}</div></div>
    </div>
  `;
}

function filterCustomers() {
  const q = normalizeText(document.getElementById("customerSearch")?.value || "");
  crmState.filtered = crmState.customers.filter(c =>
    normalizeText(c.name).includes(q) || normalizeText(c.phone).includes(q)
  );
  renderCRMStats();
  renderCustomerList();
}

/* =========================
   1. FAOL MIJOZLAR RO'YXATI
========================= */
function renderCustomerList() {
  const el = document.getElementById("customerList");
  if (!el) return;

  let customers = Array.isArray(crmState.filtered) ? crmState.filtered : crmState.customers;

  let topCustomers = customers
    .filter(c => c.phone && c.visits > 0)
    .sort((a, b) => b.visits - a.visits);

  if (!topCustomers.length) {
    el.innerHTML = `<p>${t("customers_not_found")}</p>`;
    return;
  }

  el.innerHTML = topCustomers.map((c, index) => {
    let rankIcon = "";
    if (index === 0) rankIcon = "🥇";
    else if (index === 1) rankIcon = "🥈";
    else if (index === 2) rankIcon = "🥉";
    else if (index === 3 || index === 4) rankIcon = "🎖️";
    else rankIcon = `<span style="display:inline-block; width:24px; height:24px; text-align:center; background:#e2e8f0; border-radius:50%; font-size:12px; line-height:24px; color:#475569;">${index + 1}</span>`;

    return `
    <div class="staff-card customer-card" onclick="openCustomerDetail('${escapeHtml(c.id)}')">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h3 style="margin:0; font-size:18px; display:flex; align-items:center; gap:8px;">
              ${rankIcon} ${escapeHtml(c.name || t("customer_default_name"))}
          </h3>
          <span style="background:#eef8ee; color:#28a745; padding:4px 8px; border-radius:12px; font-weight:bold; font-size:14px;">
              ${c.visits} ${t("visit_times")}
          </span>
      </div>
      <p>📞 ${t("phone_label")}: <b>${escapeHtml(c.phone)}</b></p>
      <p>💰 ${t("total_spent_label")}: <b>${formatMoney(c.totalSpent)}</b></p>
      <p>🕒 ${t("last_visit_label")}: <b>${escapeHtml(formatDateTime(c.lastVisit))}</b></p>
    </div>
  `}).join("");
}

/* =========================
   2. MIJOZ KARTASINI OCHISH VA PROMOKOD YARATISH
========================= */
window.openCustomerDetail = function openCustomerDetail(id) {
  const customer = crmState.customers.find(c => c.id === id);
  if (!customer) return;

  let modal = document.getElementById("crmDetailModal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "crmDetailModal";
    modal.className = "modal hidden";
    document.body.appendChild(modal);
  }

  modal.classList.remove("hidden");
  modal.style.display = "flex";

  modal.innerHTML = `
    <div class="modal-content">
      <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3>${escapeHtml(customer.name || t("customer_default_name"))}</h3>
          <span style="background:#eef8ee; color:#28a745; padding:4px 8px; border-radius:12px; font-weight:bold;">${customer.visits} ${t("visits_count_label")}</span>
      </div>
      <p>📞 ${t("phone_label")}: <b>${escapeHtml(customer.phone || id)}</b></p>
      <p>💰 ${t("total_spent_label")}: <b>${formatMoney(customer.totalSpent)}</b></p>

      <div style="margin: 15px 0; padding: 15px; background: #eef8ee; border-radius: 8px; border: 1px solid #c3e6cb;">
         <h4 style="margin-top:0; color:#155724;">🎫 ${t("create_promo_title")}</h4>
         <p style="font-size:13px; color:#666; margin-bottom:10px;">${t("create_promo_desc")}</p>
         <div style="display:flex; gap:10px; align-items:center;">
             <input id="promoPercentValue" type="number" placeholder="${t("promo_percent_placeholder")}" style="padding: 6px; flex:1; border-radius:4px; border:1px solid #ccc;" min="1" max="100">
             <span style="font-weight:bold; font-size:16px;">%</span>
         </div>
         <button class="btn primary" style="margin-top:10px; width:100%; background:#28a745;" onclick="generatePromoForCustomer('${customer.phone || id}')">${t("create_promo_btn")}</button>
      </div>

      <h4>${t("recent_orders_title")}</h4>
      <div>
        ${customer.recentOrders.length
      ? customer.recentOrders.map(o => `
            <div class="cash-card">
              <p>#${escapeHtml(String(o.orderNumber))} | ${t("table")} ${escapeHtml(String(o.table))}</p>
              <p>${escapeHtml(translateStatus(o.status))} — ${formatMoney(o.total)}</p>
            </div>
          `).join("")
      : `<p>${t("no_orders_found")}</p>`
    }
      </div>

      <div class="modal-actions" style="margin-top:15px;">
        <button class="btn" onclick="closeCustomerDetail()">${t("close_btn")}</button>
      </div>
    </div>
  `;
};

window.closeCustomerDetail = function () {
  const modal = document.getElementById("crmDetailModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.classList.add("hidden");
};

/* =========================
   3. PROMOKODNI BAZAGA SAQLASH
========================= */
window.generatePromoForCustomer = async function (phoneKey) {
  const val = document.getElementById("promoPercentValue").value.trim();
  const percent = Number(val);

  if (!percent || percent <= 0 || percent > 100) {
    alert(t("alert_invalid_promo_percent"));
    return;
  }

  const code = `DINE${percent}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  await set(ref(db, `discounts/${code}`), {
    code: code,
    percent: percent,
    used: false,
    ownerPhone: phoneKey,
    createdAt: Date.now(),
    createdBy: "admin"
  });

  showAdminNotification(t("promo_created_success").replace("{code}", code).replace("{percent}", percent));
  closeCustomerDetail();
};

window.closeCustomerDetail = function () {
  const modal = document.getElementById("crmDetailModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.classList.add("hidden");
};

async function loadReservations() {
  const listEl = document.getElementById("reservationList");
  const statsEl = document.getElementById("reservationStats");
  const formEl = document.getElementById("reservationForm");
  const filtersEl = document.getElementById("reservationFilters");
  if (!listEl || !statsEl || !formEl || !filtersEl) return;
  try {
    const snap = await get(ref(db, "reservations"));
    reservationState.list = Object.entries(snap.val() || {})
      .map(([id, item]) => ({ id, ...item }))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

    formEl.innerHTML = `
    <div class="form-grid">
      <input id="resGuestName" type="text" placeholder="${t("reservation_guest_name")}">
      <input id="resPhone" type="text" placeholder="${t("customer_phone")}">
      <input id="resDate" type="date">
      <input id="resTime" type="time">
      <input id="resGuests" type="number" min="1" placeholder="${t("guest_count")}">
      <input id="resTable" type="number" min="1" placeholder="${t("table_number")}">
      <input id="resSpecial" type="text" placeholder="${t("special_request_label")}">
      <button class="btn primary" onclick="createReservation()">${t("create_reservation_btn")}</button>
    </div>
  `;
    filtersEl.innerHTML = `
    <div class="form-grid">
      <select id="reservationStatusFilter" onchange="renderReservationList()">
        <option value="all">${t("all_items")}</option>
        <option value="pending">${t("reservation_status_pending")}</option>
        <option value="confirmed">${t("reservation_status_confirmed")}</option>
        <option value="seated">${t("reservation_status_seated")}</option>
        <option value="completed">${t("reservation_status_completed")}</option>
        <option value="no_show">${t("reservation_status_no_show")}</option>
        <option value="canceled">${t("reservation_status_canceled")}</option>
      </select>
    </div>
  `;
    renderReservationStats();
    renderReservationList();
  } catch (err) {
    console.error(t("reservations_load_error_log"), err);
    showAdminNotification(t("reservations_load_error"), "error");
  }
}

function renderReservationStats() {
  const el = document.getElementById("reservationStats");
  if (!el) return;
  const list = reservationState.list;
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><h4>${t("total_label")}</h4><b>${list.length}</b></div>
      <div class="stat-card"><h4>${t("today_label")}</h4><b>${list.filter(r => r.date === today).length}</b></div>
      <div class="stat-card"><h4>${t("pending_label")}</h4><b>${list.filter(r => r.status === "pending").length}</b></div>
      <div class="stat-card"><h4>${t("confirmed_label")}</h4><b>${list.filter(r => r.status === "confirmed").length}</b></div>
      <div class="stat-card"><h4>${t("no_show_label")}</h4><b>${list.filter(r => r.status === "no_show").length}</b></div>
    </div>
  `;
}

window.renderReservationList = function renderReservationList() {
  const el = document.getElementById("reservationList");
  if (!el) return;

  const filter = document.getElementById("reservationStatusFilter")?.value || "all";
  const today = new Date().toISOString().slice(0, 10);

  const items = reservationState.list.filter(
    item => filter === "all" || String(item.status || "pending") === filter
  );

  if (!items.length) {
    el.innerHTML = `<p>${t("reservations_empty")}</p>`;
    return;
  }

  el.innerHTML = items.map(item => {
    const status = String(item.status || "pending");
    const urgent = item.date === today && status === "pending";

    return `
        <div class="order-card">
          <div class="order-info">
            <h3>${escapeHtml(item.guestName || t("guest_label"))}</h3>
            <p>📞 ${escapeHtml(item.phone || uiEmpty())}</p>
            <p>📅 ${escapeHtml(item.date || uiEmpty())} ${escapeHtml(item.time || "")}</p>
            <p>👥 ${t("guest_count")}: <b>${Number(item.guests || 0)}</b></p>
            <p>🍽 ${t("table")}: <b>${escapeHtml(String(item.tableNumber || uiEmpty()))}</b></p>
            <p>📝 ${t("special_request_label")}: ${escapeHtml(item.specialRequests || uiEmpty())}</p>
            <p>${t("reservation_status")}:
    <span class="status status-${escapeHtml(status)}">${escapeHtml(translateStatus(status))}</span>
    ${urgent ? `<span class="approved">${t("urgent_badge")}</span>` : ""}
  </p>
          </div>

          <div class="order-actions">
            ${getReservationStatusActions(status).map(action => `
              <button class="btn" onclick="updateReservationStatus('${item.id}','${action.status}')">
                ${escapeHtml(action.label)}
              </button>
            `).join("")}
          </div>
        </div>
      `;
  }).join("");
};

window.createReservation = async function () {
  const guestName = document.getElementById("resGuestName")?.value?.trim();
  const phone = document.getElementById("resPhone")?.value?.trim();
  const date = document.getElementById("resDate")?.value;
  const time = document.getElementById("resTime")?.value;
  const guests = Number(document.getElementById("resGuests")?.value || 0);
  const tableNumber = Number(document.getElementById("resTable")?.value || 0);
  const specialRequests = document.getElementById("resSpecial")?.value?.trim();
  if (!guestName || !phone || !date || !time || guests < 1) {
    alert(t("fill_reservation_fields"));
    return;
  }
  await set(push(ref(db, "reservations")), {
    guestName, phone, date, time, guests,
    tableNumber: tableNumber || null,
    specialRequests: specialRequests || "",
    status: "pending", createdAt: Date.now()
  });
  showAdminNotification(t("reservation_created_success"));
  loadReservations();
};

window.updateReservationStatus = async function (id, status) {
  await update(ref(db, "reservations/" + id), { status, updatedAt: Date.now() });
  showAdminNotification(`${t("reservations_title")} → ${t("reservation_status_" + status)}`);
  loadReservations();
};

// ─── Feedbacks ───────────────────────────────────────────
async function loadFeedbacks() {
  const listEl = document.getElementById("feedbackList");
  const statsEl = document.getElementById("feedbackStats");
  const filtersEl = document.getElementById("feedbackFilters");
  if (!listEl || !statsEl || !filtersEl) return;
  try {
    const snap = await get(ref(db, "feedback"));
    feedbackState.list = Object.entries(snap.val() || {})
      .map(([id, item]) => ({ id, ...item }))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    filtersEl.innerHTML = `
    <div class="form-grid">
      <input id="feedbackDateFrom" type="date" onchange="filterFeedbacks()">
      <input id="feedbackDateTo" type="date" onchange="filterFeedbacks()">
      <input id="feedbackTableFilter" type="text" placeholder="${t("table")}" oninput="filterFeedbacks()">
      <select id="feedbackScoreFilter" onchange="filterFeedbacks()">
        <option value="all">${t("all_scores")}</option>
        <option value="5">5</option>
        <option value="4">4+</option>
        <option value="3">3+</option>
        <option value="2">${t("two_or_lower")}</option>
      </select>
    </div>
  `;
    renderFeedbackStats();
    renderFeedbackList();
  } catch (err) {
    console.error(t("feedback_load_error_log"), err);
    showAdminNotification(t("feedback_load_error"), "error");
  }
}

function renderFeedbackStats() {
  const el = document.getElementById("feedbackStats");
  if (!el) return;
  const list = feedbackState.list;
  const getScore = item => (Number(item.foodQuality || 0) + Number(item.serviceQuality || 0) + Number(item.atmosphere || 0)) / 3;
  const avg = list.length ? list.reduce((sum, item) => sum + getScore(item), 0) / list.length : 0;
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><h4>${t("feedback_total")}</h4><b>${list.length}</b></div>
      <div class="stat-card"><h4>${t("feedback_avg_rating")}</h4><b>${avg.toFixed(1)}</b></div>
      <div class="stat-card"><h4>${t("feedback_low_rating_alerts")}</h4><b>${list.filter(item => getScore(item) <= 2.5).length}</b></div>
    </div>
  `;
}

function renderFeedbackList(customList = null) {
  const el = document.getElementById("feedbackList");
  if (!el) return;
  const list = customList || feedbackState.list;
  if (!list.length) {
    el.innerHTML = `<p>${t("feedback_empty")}</p>`;
    return;
  }
  el.innerHTML = list.map(item => `
      <div class="cash-card">
        <h4>${t("order_label")} #${escapeHtml(String(item.orderNumber || item.orderId || uiEmpty()))}</h4>
        <p>🍽 ${t("table")}: <b>${escapeHtml(String(item.table || item.tableNumber || uiEmpty()))}</b></p>
        <p>🍲 ${t("food_quality_label")}: <b>${Number(item.foodQuality || 0)}</b></p>
        <p>🧑‍🍳 ${t("service_quality_label")}: <b>${Number(item.serviceQuality || 0)}</b></p>
        <p>🏠 ${t("atmosphere_label")}: <b>${Number(item.atmosphere || 0)}</b></p>
        <p>👍 ${t("recommend_label")}: <b>${item.wouldRecommend ? t("yes_label") : t("no_label")}</b></p>
        <p>🕒 ${escapeHtml(formatDateTime(item.createdAt))}</p>
      </div>
    `).join("");
}

window.filterFeedbacks = function filterFeedbacks() {
  const from = document.getElementById("feedbackDateFrom")?.value;
  const to = document.getElementById("feedbackDateTo")?.value;
  const table = normalizeText(document.getElementById("feedbackTableFilter")?.value || "");
  const scoreFilter = document.getElementById("feedbackScoreFilter")?.value || "all";

  const getScore = item =>
    (Number(item.foodQuality || 0) +
      Number(item.serviceQuality || 0) +
      Number(item.atmosphere || 0)) / 3;

  renderFeedbackList(
    feedbackState.list.filter(item => {
      const itemDate = item.createdAt ? new Date(item.createdAt) : null;

      if (from && itemDate && itemDate < new Date(from)) return false;

      if (to && itemDate) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        if (itemDate > end) return false;
      }

      if (table && !normalizeText(item.table || item.tableNumber || "").includes(table)) {
        return false;
      }

      const score = getScore(item);

      if (scoreFilter === "5" && score < 5) return false;
      if (scoreFilter === "4" && score < 4) return false;
      if (scoreFilter === "3" && score < 3) return false;
      if (scoreFilter === "2" && score > 2.5) return false;

      return true;
    })
  );
};

function getReadNotifications() {
  try { return JSON.parse(localStorage.getItem("foodify_admin_notifications_read") || "[]"); }
  catch { return []; }
}

function setReadNotifications(ids) {
  localStorage.setItem("foodify_admin_notifications_read", JSON.stringify(ids));
}

async function loadNotifications() {
  const el = document.getElementById("notificationsList");
  if (!el) return;
  const [ordersSnap, reservationsSnap, feedbackSnap] = await Promise.all([
    get(ref(db, "orders")), get(ref(db, "reservations")), get(ref(db, "feedback"))
  ]);
  const orders = Object.entries(ordersSnap.val() || {});
  const reservations = Object.entries(reservationsSnap.val() || {});
  const feedback = Object.entries(feedbackSnap.val() || {});
  const now = Date.now();
  const list = [];

  orders.forEach(([id, order]) => {
    if (order.payment?.requested && !order.payment?.paid) {
      list.push({
        id: `payment_${id}`, type: "payment",
        text: `${t("notification_payment_request")} — ${t("table")} ${order.table}, ${formatMoney(order.total)}`,
        createdAt: getOrderTimestamp(order)
      });
    }
    const status = normalizeText(order.status || order.statusKey || "");
    const diffMin = (now - getOrderTimestamp(order)) / 60000;
    if ((status === "tayyorlanmoqda" || status === "cooking") && diffMin >= 20) {
      list.push({
        id: `delayed_${id}`, type: "delay",
        text: `${t("notification_delayed_order")} — #${order.orderNumber || id}, ${t("table")} ${order.table}`,
        createdAt: getOrderTimestamp(order)
      });
    }
    if (status === "tayyor" || status === "ready") {
      list.push({
        id: `ready_${id}`, type: "ready",
        text: `${t("notification_ready_order")} — #${order.orderNumber || id}, ${t("table")} ${order.table}`,
        createdAt: getOrderTimestamp(order)
      });
    }
  });

  reservations.forEach(([id, item]) => {
    if (item.status === "pending") {
      list.push({
        id: `reservation_${id}`, type: "reservation",
        text: `${t("notification_pending_reservation")} — ${item.guestName || t("guest_label")} (${item.date} ${item.time})`,
        createdAt: Number(item.createdAt || 0)
      });
    }
  });

  feedback.forEach(([id, item]) => {
    const score = (Number(item.foodQuality || 0) + Number(item.serviceQuality || 0) + Number(item.atmosphere || 0)) / 3;
    if (score <= 2.5) {
      list.push({
        id: `feedback_${id}`, type: "feedback",
        text: `${t("feedback_low_rating_alerts")} — ${t("table")} ${item.table || item.tableNumber || uiEmpty()} (${score.toFixed(1)})`,
        createdAt: Number(item.createdAt || 0)
      });
    }
  });

  notificationsState.list = list.sort((a, b) => b.createdAt - a.createdAt);
  renderNotifications();
}

function renderNotifications() {
  const el = document.getElementById("notificationsList");
  if (!el) return;
  const read = getReadNotifications();
  if (!notificationsState.list.length) {
    el.innerHTML = `<p>${t("notifications_empty")}</p>`;
    return;
  }
  el.innerHTML = notificationsState.list.map(item => `
      <div class="cash-card ${read.includes(item.id) ? "read-item" : ""}">
        <p><b>${escapeHtml(translateNotificationType(item.type))}</b></p>
        <p>${escapeHtml(item.text)}</p>
        <p>${escapeHtml(formatDateTime(item.createdAt))}</p>
        <button class="btn" onclick="markNotificationRead('${item.id}')">
          ${read.includes(item.id) ? t("notification_status_read") : t("mark_as_read_btn")}
        </button>
      </div>
    `).join("");
}

window.markNotificationRead = function (id) {
  const read = getReadNotifications();
  if (!read.includes(id)) { read.push(id); setReadNotifications(read); }
  renderNotifications();
};

const ROLE_TEMPLATES = {
  admin: ["dashboard", "orders", "menu", "tables", "staff", "customers", "report", "notifications", "roles", "audit_log", "settings"],
  manager: ["dashboard", "orders", "tables", "staff", "customers", "report", "notifications"],
  cashier: ["dashboard", "orders", "customers", "notifications"],
  waiter: ["dashboard", "orders", "tables", "customers", "reservations"],
  chef: ["dashboard", "orders", "notifications"],
  client: ["dashboard"]
};

const ALL_PERMISSIONS = [
  "dashboard",
  "orders",
  "menu",
  "tables",
  "staff",
  "customers",
  "report",
  "notifications",
  "roles",
  "audit_log",
  "settings",
  "reservations"
];

let currentRoleUserId = null;

async function loadRoles() {
  const statsEl = document.getElementById("rolesStats");
  const tableEl = document.getElementById("rolesUsersTable");
  const templatesEl = document.getElementById("rolesTemplates");
  const searchEl = document.getElementById("rolesSearch");

  if (!statsEl || !tableEl || !templatesEl) return;

  const snap = await get(ref(db, "users"));
  const users = Object.entries(snap.val() || {}).map(([id, u]) => ({
    id,
    name: u.name || uiEmpty(),
    role: u.role || "waiter",
    active: u.active !== false,
    permissions: Array.isArray(u.permissions) ? u.permissions : (ROLE_TEMPLATES[u.role] || [])
  }));

  window.rolesLoadedUsers = users;

  renderRolesStats(users);
  renderRolesTemplates();
  renderRolesTable(users);

  if (searchEl && !searchEl.dataset.bound) {
    searchEl.dataset.bound = "1";
    searchEl.addEventListener("input", () => {
      const q = normalizeText(searchEl.value);
      const filtered = (window.rolesLoadedUsers || []).filter(u =>
        normalizeText(u.name).includes(q) ||
        normalizeText(u.role).includes(q)
      );
      renderRolesTable(filtered);
    });
  }
}

function startNotificationsAutoRefresh() {
  if (window.__notificationsInterval) clearInterval(window.__notificationsInterval);

  window.__notificationsInterval = setInterval(() => {
    const section = document.getElementById("notifications");
    if (section && section.style.display !== "none") {
      loadNotifications();
    }
  }, 5000);
}

function renderRolesStats(users) {
  const statsEl = document.getElementById("rolesStats");
  if (!statsEl) return;

  const total = users.length;
  const admins = users.filter(u => u.role === "admin").length;
  const active = users.filter(u => u.active).length;
  const custom = users.filter(u => Array.isArray(u.permissions) && u.permissions.length).length;

  statsEl.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><h4>${t("roles_total_users")}</h4><b>${total}</b></div>
        <div class="stat-card"><h4>${t("roles_admin_count")}</h4><b>${admins}</b></div>
        <div class="stat-card"><h4>${t("status_active")}</h4><b>${active}</b></div>
        <div class="stat-card"><h4>${t("roles_custom_permissions")}</h4><b>${custom}</b></div>
      </div>
    `;
}

function renderRolesTemplates() {
  const el = document.getElementById("rolesTemplates");
  if (!el) return;

  el.innerHTML = Object.entries(ROLE_TEMPLATES).map(([role, permissions]) => `
      <div class="cash-card">
        <h4>${t("role_" + role)}</h4>
        <p>${permissions.map(p => t("permission_" + p) || p).join(", ")}</p>
      </div>
    `).join("");
}

function renderRolesTable(users) {
  const tableEl = document.getElementById("rolesUsersTable");
  if (!tableEl) return;

  if (!users.length) {
    tableEl.innerHTML = `<tr><td colspan="5">${t("roles_empty")}</td></tr>`;
    return;
  }

  tableEl.innerHTML = users.map(user => `
      <tr>
        <td>${escapeHtml(user.name)}</td>
        <td>${t("role_" + user.role)}</td>
        <td>${user.active ? t("status_active") : t("status_inactive")}</td>
        <td>${(user.permissions || []).map(p => t("permission_" + p) || p).join(", ")}</td>
        <td>
          <button class="btn" onclick="openRoleModal('${user.id}')">${t("view_btn")}</button>
        </td>
      </tr>
    `).join("");
}

window.openRoleModal = function (userId) {
  const modal = document.getElementById("roleModal");
  const body = document.getElementById("rolePermissionsGrid");
  const user = (window.rolesLoadedUsers || []).find(u => u.id === userId);
  if (!modal || !body || !user) return;

  currentRoleUserId = userId;
  document.getElementById("roleModalTitle").textContent = `${t("role_detail_title")}: ${user.name}`;
  document.getElementById("roleUserName").value = user.name;
  document.getElementById("roleUserRole").value = user.role;

  const permissions = user.permissions?.length ? user.permissions : (ROLE_TEMPLATES[user.role] || []);

  body.innerHTML = ALL_PERMISSIONS.map(permission => `
      <label class="permission-item">
        <input type="checkbox" class="role-permission-checkbox" value="${permission}" ${permissions.includes(permission) ? "checked" : ""}>
        <span>${t("permission_" + permission) || permission}</span>
      </label>
    `).join("");

  modal.classList.remove("hidden");
};

window.closeRoleModal = function () {
  document.getElementById("roleModal")?.classList.add("hidden");
  currentRoleUserId = null;
};

window.saveRolePermissions = async function () {
  if (!currentRoleUserId) return;

  const role = document.getElementById("roleUserRole")?.value || "waiter";
  const permissions = [...document.querySelectorAll(".role-permission-checkbox:checked")].map(el => el.value);

  await update(ref(db, `users/${currentRoleUserId}`), {
    role,
    permissions,
    updatedAt: Date.now()
  });

  await crmAdvAudit(
    "roles",
    "update",
    currentRoleUserId,
    t("role_permissions_updated_audit"),
    { role, permissions },
    "critical"
  );

  crmAdvNotify(t("role_permissions_saved"));
  closeRoleModal();
  loadRoles();
};

async function loadSettings() {
  const formEl = document.getElementById("settingsForm");
  if (!formEl) return;
  const snap = await get(ref(db, "settings"));
  const settings = snap.val() || {};
  formEl.innerHTML = `
    <div class="form-grid">
      <input id="restaurantName" type="text" placeholder="${t("settings_restaurant_name")}" value="${escapeHtml(settings.restaurantName || "")}">
      <input id="workingHours" type="text" placeholder="${t("settings_working_hours")}" value="${escapeHtml(settings.workingHours || "")}">
      <input id="serviceFee" type="number" placeholder="${t("settings_service_fee")}" value="${Number(settings.serviceFee || 0)}">
      
      <div class="settings-group" style="grid-column: 1 / -1; background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #ddd;">
        <h4 style="margin-top:0; margin-bottom: 15px; color: #333;">⚡ ${t("fast_and_normal_order_title")}</h4>
        <div style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap;">
            <label style="font-size: 14px;">${t("fast_fee_percent")}: <br><input id="fastFee" type="number" style="width:100px; margin-top:5px;" value="${Number(settings.fastFee || 5)}"></label>
            <label style="font-size: 14px;">${t("fast_minus_mins")}: <br><input id="fastMinusMins" type="number" style="width:100px; margin-top:5px;" value="${Number(settings.fastOrderMinusMinutes || 10)}"></label>
            <label style="font-size: 14px;">${t("normal_time_mins")}: <br><input id="normalTime" type="number" style="width:100px; margin-top:5px;" value="${Number(settings.normalOrderBaseTime || 30)}"></label>
            
            <label style="font-size: 14px;">${t("fast_min_amount")}: <br><input id="fastMinAmount" type="number" style="width:100px; margin-top:5px;" value="${Number(settings.fastOrderMinAmount || 80000)}"></label>
            
            <label style="display:flex; align-items:center; gap:5px; font-weight:bold; color:#dc3545; cursor:pointer; margin-top: 15px;">
              <input id="fastOrderActive" type="checkbox" ${settings.fastOrderActive !== false ? "checked" : ""} style="width: 20px; height: 20px;"> 
             ${t("fast_order_active_toggle")}
            </label>
        </div>
      </div>

      <input id="paymeLink" type="text" placeholder="${t("settings_payme_link")}" value="${escapeHtml(settings.paymeLink || "")}">
      <input id="clickLink" type="text" placeholder="${t("settings_click_link")}" value="${escapeHtml(settings.clickLink || "")}">
      <input id="maxTablesSettings" type="number" min="1" placeholder="${t("settings_max_tables")}" value="${Number(settings.maxTable || 0)}">
      
      <select id="defaultLanguage">
        <option value="uz" ${settings.defaultLanguage === "uz" ? "selected" : ""}>${t("lang_uz")}</option>
        <option value="ru" ${settings.defaultLanguage === "ru" ? "selected" : ""}>${t("lang_ru")}</option>
        <option value="en" ${settings.defaultLanguage === "en" ? "selected" : ""}>${t("lang_en")}</option>
      </select>
      
      <label style="grid-column: 1 / -1; display:flex; align-items:center; gap:8px;">
        <input id="notificationsEnabled" type="checkbox" ${settings.notificationsEnabled !== false ? "checked" : ""}>
        ${t("settings_notifications_enabled")}
      </label>
      
      <button class="btn primary" style="grid-column: 1 / -1; padding: 12px;" onclick="saveSettings()">${t("save_settings_btn")}</button>
    </div>
  `;
}

window.saveSettings = async function () {
  const data = {
    restaurantName: document.getElementById("restaurantName")?.value?.trim() || "",
    workingHours: document.getElementById("workingHours")?.value?.trim() || "",
    serviceFee: Number(document.getElementById("serviceFee")?.value || 0),

    fastFee: Number(document.getElementById("fastFee")?.value || 5),
    fastOrderMinusMinutes: Number(document.getElementById("fastMinusMins")?.value || 10),
    normalOrderBaseTime: Number(document.getElementById("normalTime")?.value || 30),

    fastOrderMinAmount: Number(document.getElementById("fastMinAmount")?.value || 80000),

    fastOrderActive: !!document.getElementById("fastOrderActive")?.checked,

    paymeLink: document.getElementById("paymeLink")?.value?.trim() || "",
    clickLink: document.getElementById("clickLink")?.value?.trim() || "",
    maxTable: Number(document.getElementById("maxTablesSettings")?.value || 0),
    defaultLanguage: document.getElementById("defaultLanguage")?.value || "uz",
    notificationsEnabled: !!document.getElementById("notificationsEnabled")?.checked,
    updatedAt: Date.now()
  };

  await update(ref(db, "settings"), data);
  showAdminNotification(t("settings_saved_success"));
};

async function loadTablesAdvanced() {
  const gridEl = document.getElementById("tablesGrid");
  const statsEl = document.getElementById("tablesStats");
  if (!gridEl || !statsEl) return;
  const [tablesSnap, ordersSnap] = await Promise.all([
    get(ref(db, "tables")), get(ref(db, "orders"))
  ]);
  tablesAdvancedState.tables = tablesSnap.val() || {};
  tablesAdvancedState.orders = ordersSnap.val() || {};
  renderTablesGrid();
}

let auditLoadedRows = [];

async function loadAuditLog() {
  const statsEl = document.getElementById("auditStats");
  const tableEl = document.getElementById("auditLogTableBody");
  const searchEl = document.getElementById("auditSearch");
  const moduleFilterEl = document.getElementById("auditModuleFilter");
  const severityFilterEl = document.getElementById("auditSeverityFilter");

  if (!statsEl || !tableEl) return;

  const snap = await get(ref(db, "activityLogs"));
  auditLoadedRows = Object.entries(snap.val() || {})
    .map(([id, row]) => ({ id, ...row }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

  renderAuditStats(auditLoadedRows);
  renderAuditTable(auditLoadedRows);

  if (searchEl && !searchEl.dataset.bound) {
    searchEl.dataset.bound = "1";
    searchEl.addEventListener("input", filterAuditRows);
  }
  if (moduleFilterEl && !moduleFilterEl.dataset.bound) {
    moduleFilterEl.dataset.bound = "1";
    moduleFilterEl.addEventListener("change", filterAuditRows);
  }
  if (severityFilterEl && !severityFilterEl.dataset.bound) {
    severityFilterEl.dataset.bound = "1";
    severityFilterEl.addEventListener("change", filterAuditRows);
  }
}

function renderAuditStats(rows) {
  const statsEl = document.getElementById("auditStats");
  if (!statsEl) return;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const total = rows.length;
  const today = rows.filter(r => Number(r.createdAt || 0) >= todayStart.getTime()).length;
  const critical = rows.filter(r => r.severity === "critical").length;
  const users = new Set(rows.map(r => r.userId || r.userName)).size;

  statsEl.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><h4>${t("audit_total_logs")}</h4><b>${total}</b></div>
        <div class="stat-card"><h4>${t("audit_today_logs")}</h4><b>${today}</b></div>
        <div class="stat-card"><h4>${t("audit_critical_logs")}</h4><b>${critical}</b></div>
        <div class="stat-card"><h4>${t("audit_unique_users")}</h4><b>${users}</b></div>
      </div>
    `;
}

function renderAuditTable(rows) {
  const tableEl = document.getElementById("auditLogTableBody");
  if (!tableEl) return;

  if (!rows.length) {
    tableEl.innerHTML = `<tr><td colspan="7">${t("audit_empty")}</td></tr>`;
    return;
  }

  tableEl.innerHTML = rows.map(row => `
    <tr>
      <td>${escapeHtml(formatDateTime(row.createdAt))}</td>
      <td>${escapeHtml(translateAuditUserName(row.userName || uiEmpty()))}</td>
      <td>${escapeHtml(translateAuditModule(row.module || uiEmpty()))}</td>
      <td>${escapeHtml(translateAuditAction(row.action || uiEmpty()))}</td>
      <td>${escapeHtml(translateAuditTarget(row.target || uiEmpty()))}</td>
      <td>${escapeHtml(translateAuditSeverity(row.severity || "info"))}</td>
      <td>
        <button class="btn" onclick="openAuditModal('${row.id}')">${t("view_btn")}</button>
      </td>
    </tr>
  `).join("");
}

window.filterAuditRows = function () {
  const q = normalizeText(document.getElementById("auditSearch")?.value || "");
  const moduleValue = document.getElementById("auditModuleFilter")?.value || "all";
  const severityValue = document.getElementById("auditSeverityFilter")?.value || "all";

  const filtered = auditLoadedRows.filter(row => {
    const matchesSearch =
      normalizeText(row.userName).includes(q) ||
      normalizeText(row.module).includes(q) ||
      normalizeText(row.action).includes(q) ||
      normalizeText(row.target).includes(q);

    const matchesModule = moduleValue === "all" || row.module === moduleValue;
    const matchesSeverity = severityValue === "all" || row.severity === severityValue;

    return matchesSearch && matchesModule && matchesSeverity;
  });

  renderAuditTable(filtered);
};

window.openAuditModal = function (id) {
  const row = auditLoadedRows.find(r => r.id === id);
  const modal = document.getElementById("auditModal");
  const body = document.getElementById("auditModalBody");
  if (!modal || !body || !row) return;

  document.getElementById("auditModalTitle").textContent = `${t("audit_detail_title")}: ${row.target || id}`;

  body.innerHTML = `
      <p><b>${t("date_label")}:</b> ${escapeHtml(formatDateTime(row.createdAt))}</p>
      <p><b>${t("user_name_label")}:</b> ${escapeHtml(row.userName || uiEmpty())}</p>
      <p><b>${t("audit_module")}:</b> ${escapeHtml(translateAuditModule(row.module || uiEmpty()))}</p>
      <p><b>${t("audit_action")}:</b> ${escapeHtml(translateAuditAction(row.action || uiEmpty()))}</p>
      <p><b>${t("audit_target")}:</b> ${escapeHtml(row.target || uiEmpty())}</p>
      <p><b>${t("audit_severity")}:</b> ${escapeHtml(translateAuditSeverity(row.severity || uiEmpty()))}</p>
      <p><b>${t("audit_description")}:</b> ${escapeHtml(row.description || uiEmpty())}</p>
      <pre style="white-space:pre-wrap">${escapeHtml(JSON.stringify(row.payload || {}, null, 2))}</pre>
    `;

  modal.classList.remove("hidden");
};

window.closeAuditModal = function () {
  document.getElementById("auditModal")?.classList.add("hidden");
};

function renderTablesGrid() {
  const gridEl = document.getElementById("tablesGrid");
  const statsEl = document.getElementById("tablesStats");
  if (!gridEl || !statsEl) return;
  const tables = Object.entries(tablesAdvancedState.tables || {});
  const orders = tablesAdvancedState.orders || {};
  let free = 0, active = 0, billing = 0, cleaning = 0;
  tables.forEach(([_, table]) => {
    const status = normalizeText(table.status || (table.busy ? "active" : "free"));
    if (status === "free") free++;
    else if (status === "billing") billing++;
    else if (status === "cleaning") cleaning++;
    else active++;
  });
  statsEl.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><h4>${t("free_label")}</h4><b>${free}</b></div>
      <div class="stat-card"><h4>${t("active_label")}</h4><b>${active}</b></div>
      <div class="stat-card"><h4>${t("billing_label")}</h4><b>${billing}</b></div>
      <div class="stat-card"><h4>${t("cleaning_label")}</h4><b>${cleaning}</b></div>
    </div>
  `;
  if (!tables.length) { gridEl.innerHTML = `<p>${t("tables_not_found")}</p>`; return; }

  gridEl.innerHTML = tables.map(([tableNo, table]) => {
    const activeOrder = Object.values(orders).find(o => String(o.table) === String(tableNo) && !o.tableClosed);
    const elapsed = activeOrder?.createdAt
      ? `${Math.max(0, Math.floor((Date.now() - activeOrder.createdAt) / 60000))} ${t("minute_short")}` : uiEmpty();
    return `
    <div class="staff-card table-card" onclick="openTableDetail('${tableNo}')">
      <h3>${t("table")} ${escapeHtml(String(tableNo))}</h3>
      <p>${t("status_label")}: <b>${escapeHtml(translateStatus(table.status || "free"))}</b></p>
      <p>${t("zone_label")}: <b>${escapeHtml(translateZone(String(table.zone || "main")))}</b></p>
      <p>${t("capacity_label")}: <b>${escapeHtml(String(table.capacity || uiEmpty()))}</b></p>
      <p>${t("pulse_label")}: <b>${escapeHtml(translatePulse(String(table.servicePulse || table.mood || "green")))}</b></p>
      <p>${t("elapsed_time_label")}: <b>${escapeHtml(elapsed)}</b></p>
      <p>${t("active_order_label")}: <b>${activeOrder ? "#" + escapeHtml(String(activeOrder.orderNumber || uiEmpty())) : uiEmpty()}</b></p>
      <div class="staff-actions">
        <button class="btn" onclick="event.stopPropagation(); updateTableLifecycle('${tableNo}','reserved')">${t("reserve_btn")}</button>
        <button class="btn" onclick="event.stopPropagation(); updateTableLifecycle('${tableNo}','billing')">${t("billing_label")}</button>
        <button class="btn" onclick="event.stopPropagation(); updateTableLifecycle('${tableNo}','cleaning')">${t("cleaning_label")}</button>
        <button class="btn danger" onclick="event.stopPropagation(); updateTableLifecycle('${tableNo}','free')">${t("mark_free_btn")}</button>
      </div>
    </div>
  `;
  }).join("");
}

window.openTableDetail = function (tableNo) {
  const modal = document.getElementById("tableDetailModal");
  if (!modal) return;
  const table = tablesAdvancedState.tables?.[tableNo] || {};
  const activeOrder = Object.values(tablesAdvancedState.orders || {}).find(
    o => String(o.table) === String(tableNo) && !o.tableClosed
  );
  modal.classList.remove("hidden");
  modal.style.display = "flex";
  modal.innerHTML = `
    <div class="modal-content">
      <h3>${t("table")} ${escapeHtml(String(tableNo))}</h3>
      <p>${t("status_label")}: <b>${escapeHtml(translateStatus(table.status || "free"))}</b></p>
      <p>${t("zone_label")}: <b>${escapeHtml(translateZone(String(table.zone || "main")))}</b></p>
      <p>${t("capacity_label")}: <b>${escapeHtml(String(table.capacity || uiEmpty()))}</b></p>
      <p>${t("service_status_label")}: <b>${escapeHtml(translatePulse(String(table.servicePulse || table.mood || "green")))}</b></p>
      <p>${t("busy_label")}: <b>${table.busy ? t("yes_label") : t("no_label")}</b></p>
      <h4>${t("lifecycle_title")}</h4>
      <div class="modal-actions">
        <button class="btn" onclick="updateTableLifecycle('${tableNo}','reserved')">${t("reserve_btn")}</button>
        <button class="btn" onclick="updateTableLifecycle('${tableNo}','seated')">${t("seated_btn")}</button>
        <button class="btn" onclick="updateTableLifecycle('${tableNo}','billing')">${t("request_bill_btn")}</button>
        <button class="btn" onclick="updateTableLifecycle('${tableNo}','cleaning')">${t("start_cleaning_btn")}</button>
        <button class="btn danger" onclick="updateTableLifecycle('${tableNo}','free')">${t("mark_free_btn")}</button>
      </div>
      <h4>${t("active_order_label")}</h4>
      ${activeOrder
      ? `<div class="cash-card">
          <p>${t("order_label")}: <b>#${escapeHtml(String(activeOrder.orderNumber || uiEmpty()))}</b></p>
          <p>${t("total_label")}: <b>${formatMoney(activeOrder.total || 0)}</b></p>
          <p>${t("status_label")}: <b>${escapeHtml(translateStatus(activeOrder.statusLabel || activeOrder.status || uiEmpty()))}</b></p>
        </div>`
      : `<p>${t("no_active_order")}</p>`}
      <div class="modal-actions">
        <button class="btn" onclick="
  document.getElementById('tableDetailModal').classList.add('hidden');
  document.getElementById('tableDetailModal').style.display='none';
  ">${t("close_btn")}</button>
      </div>
    </div>
  `;
};

window.updateTableLifecycle = async function (tableNo, status) {
  const updates = { status, busy: !["free", "cleaning"].includes(status), updatedAt: Date.now() };
  if (status === "free") { updates.orderId = null; updates.closedByAdmin = true; }
  await update(ref(db, `tables/${tableNo}`), updates);
  showAdminNotification(`${t("table_label")} ${tableNo} → ${t("table_status_" + status)}`);
  loadTablesAdvanced();
};

window.crmAdvancedState = {
  segments: null,
  campaigns: [],
  complaints: [],
  notes: {}
};

function crmAdvSafeKey(value = "") {
  return encodeURIComponent(String(value || "unknown"));
}

function crmAdvNow() {
  return Date.now();
}

function crmAdvNotify(text, type = "success") {
  if (typeof showAdminNotification === "function") {
    showAdminNotification(text, type);
  } else {
    console.log(text);
  }
}

function crmAdvActor() {
  try {
    const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
    return {
      id: currentUser.id || "admin_local",
      name: currentUser.name || t("admin"),
      role: currentUser.role || localStorage.getItem("role") || "admin"
    };
  } catch {
    return {
      id: "admin_local",
      name: t("admin"),
      role: localStorage.getItem("role") || "admin"
    };
  }
}

async function crmAdvAudit(
  module,
  action,
  target,
  description,
  payload = {},
  severity = "info"
) {
  await push(ref(db, "activityLogs"), {
    userId: crmAdvActor().id,
    userName: crmAdvActor().name,
    userRole: crmAdvActor().role,
    module,
    action,
    target,
    severity,
    description,
    payload,
    createdAt: crmAdvNow()
  });
}

function crmAdvFindCustomer(customerId) {
  const list = crmState?.customers || [];
  return list.find(c => String(c.id) === String(customerId)) || null;
}

function crmAdvOrderCustomerId(order = {}) {
  return order.customerId || order.customerPhone || order.phone || `table_${order.table || "unknown"}`;
}

function crmAdvOrderCustomerName(order = {}) {
  return order.customerName || order.clientName || order.name || `${t("table")} ${order.table || uiEmpty()}`;
}

function crmAdvOrderCustomerPhone(order = {}) {
  return order.customerPhone || order.phone || "";
}

async function crmAdvEnsureOrder(orderId) {
  const snap = await get(ref(db, `orders/${orderId}`));
  return snap.exists() ? snap.val() : null;
}

/* ==============================
  CUSTOMER NOTES
============================== */
window.saveCustomerNote = async function saveCustomerNote(customerId, note, meta = {}) {
  const cleanNote = String(note || "").trim();

  if (!customerId || !cleanNote) {
    alert(t("customer_note_required"));
    return null;
  }

  const customer = crmAdvFindCustomer(customerId);
  const customerKey = crmAdvSafeKey(customerId);
  const noteRef = push(ref(db, `customerNotes/${customerKey}`));

  const payload = {
    customerId,
    customerName: customer?.name || meta.customerName || t("unknown_label"),
    customerPhone: customer?.phone || meta.customerPhone || "",
    note: cleanNote,
    tags: meta.tags || [],
    pinned: !!meta.pinned,
    source: meta.source || "admin",
    createdAt: crmAdvNow(),
    createdBy: crmAdvActor().id,
    createdByName: crmAdvActor().name
  };

  await set(noteRef, payload);

  if (meta.orderId) {
    await window.createOrderTimelineEvent(meta.orderId, "customer_note_added", {
      customerId,
      note: cleanNote,
      noteId: noteRef.key
    });
  }

  await crmAdvAudit(
    "customers",
    "note_add",
    customerId,
    t("audit_customer_note_saved"),
    { noteId: noteRef.key, ...payload },
    "info"
  );

  crmAdvNotify(t("customer_note_saved"));
  return noteRef.key;
};

/* ==============================
  CUSTOMER SEGMENTS
============================== */
window.buildCustomerSegments = async function buildCustomerSegments(options = {}) {
  const defaults = {
    vipSpent: 1500000,
    goldSpent: 800000,
    silverSpent: 300000,
    loyalVisits: 5,
    atRiskDays: 30,
    newCustomerDays: 7,
    couponUsersMin: 1,
    cashbackMin: 50000
  };

  const cfg = { ...defaults, ...options };
  let customers = crmState?.customers || [];

  if (!customers.length) {
    const [ordersSnap, customersSnap, usersSnap] = await Promise.all([
      get(ref(db, "orders")),
      get(ref(db, "customers")),
      get(ref(db, "users"))
    ]);

    const orders = ordersSnap.val() || {};
    const customerProfiles = customersSnap.val() || {};
    const users = usersSnap.val() || {};

    if (typeof buildCustomerMapFromOrders === "function") {
      customers = buildCustomerMapFromOrders(orders, customerProfiles, users);
    } else {
      customers = [];
    }
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const segments = {
    vip: [],
    gold: [],
    silver: [],
    loyal: [],
    atRisk: [],
    newCustomers: [],
    couponUsers: [],
    cashbackHeavy: [],
    highValueLowVisit: []
  };

  customers.forEach(customer => {
    const spent = Number(customer.totalSpent || customer.spent || 0);
    const visits = Number(customer.visits || 0);
    const cashback = Number(customer.cashbackBalance || customer.cashback || 0);
    const promoCount = Array.isArray(customer.promoCodesUsed)
      ? customer.promoCodesUsed.length
      : 0;

    const lastVisit = Number(customer.lastVisit || 0);
    const daysSinceLastVisit = lastVisit
      ? Math.floor((now - lastVisit) / dayMs)
      : 9999;

    if (spent >= cfg.vipSpent || customer.loyalty === "vip") {
      segments.vip.push(customer);
    } else if (spent >= cfg.goldSpent || customer.loyalty === "gold") {
      segments.gold.push(customer);
    } else if (spent >= cfg.silverSpent || customer.loyalty === "silver") {
      segments.silver.push(customer);
    }

    if (visits >= cfg.loyalVisits) segments.loyal.push(customer);
    if (visits > 0 && daysSinceLastVisit >= cfg.atRiskDays) segments.atRisk.push(customer);
    if (visits <= 2 && daysSinceLastVisit <= cfg.newCustomerDays) segments.newCustomers.push(customer);
    if (promoCount >= cfg.couponUsersMin) segments.couponUsers.push(customer);
    if (cashback >= cfg.cashbackMin) segments.cashbackHeavy.push(customer);
    if (spent >= cfg.goldSpent && visits <= 2) segments.highValueLowVisit.push(customer);
  });

  const summary = Object.fromEntries(
    Object.entries(segments).map(([key, list]) => [key, list.length])
  );

  const result = {
    builtAt: crmAdvNow(),
    config: cfg,
    summary,
    segments: Object.fromEntries(
      Object.entries(segments).map(([key, list]) => [
        key,
        list.map(c => ({
          id: c.id,
          name: c.name,
          phone: c.phone || "",
          visits: Number(c.visits || 0),
          totalSpent: Number(c.totalSpent || c.spent || 0),
          cashbackBalance: Number(c.cashbackBalance || c.cashback || 0),
          loyalty: c.loyalty || c.level || "bronze",
          lastVisit: Number(c.lastVisit || 0)
        }))
      ])
    )
  };

  await set(ref(db, "customerSegments/generated"), result);
  window.crmAdvancedState.segments = result;

  await crmAdvAudit(
    "customers",
    "segment_build",
    "customerSegments/generated",
    t("audit_customer_segments_rebuilt"),
    { summary, config: cfg },
    "info"
  );

  crmAdvNotify(t("customer_segments_built"));
  return result;
};

/* ==============================
  CAMPAIGNS
============================== */
window.createCampaign = async function createCampaign(payload = {}) {
  const name = String(payload.name || "").trim();

  if (!name) {
    alert(t("campaign_name_required"));
    return null;
  }

  const segmentKey = payload.segmentKey || "all";
  let recipientsCount = 0;
  let segmentSnapshot = window.crmAdvancedState.segments;

  if (!segmentSnapshot && segmentKey !== "all") {
    segmentSnapshot = await window.buildCustomerSegments();
  }

  if (segmentKey === "all") {
    recipientsCount = (crmState?.customers || []).length;
  } else {
    recipientsCount = segmentSnapshot?.segments?.[segmentKey]?.length || 0;
  }

  const campaignRef = push(ref(db, "campaigns"));

  const campaignData = {
    name,
    type: payload.type || "coupon",
    segmentKey,
    message: payload.message || "",
    couponCode: payload.couponCode || "",
    discountType: payload.discountType || "fixed",
    discountValue: Number(payload.discountValue || 0),
    startsAt: payload.startsAt || "",
    endsAt: payload.endsAt || "",
    status: payload.status || "draft",
    recipientsCount,
    redeemedCount: 0,
    createdAt: crmAdvNow(),
    createdBy: crmAdvActor().id,
    createdByName: crmAdvActor().name
  };

  await set(campaignRef, campaignData);

  if (campaignData.couponCode) {
    await set(ref(db, `coupons/${crmAdvSafeKey(campaignData.couponCode)}`), {
      campaignId: campaignRef.key,
      code: campaignData.couponCode,
      discountType: campaignData.discountType,
      discountValue: campaignData.discountValue,
      status: campaignData.status,
      startsAt: campaignData.startsAt,
      endsAt: campaignData.endsAt,
      createdAt: crmAdvNow()
    });
  }

  await crmAdvAudit(
    "marketing",
    "campaign_create",
    campaignRef.key,
    t("audit_campaign_created"),
    campaignData,
    "info"
  );

  crmAdvNotify(t("campaign_created_success"));
  return campaignRef.key;
};

/* ==============================
  COUPON REDEMPTION
============================== */
window.trackCouponRedemption = async function ({
  customerId = "",
  couponCode = "",
  campaignId = "",
  orderId = "",
  amount = 0,
  discountAmount = 0,
  tableNumber = ""
} = {}) {
  const cleanCoupon = String(couponCode || "").trim();

  if (!cleanCoupon) {
    alert(t("coupon_code_required"));
    return null;
  }

  const actor = crmAdvActor();
  const redemptionRef = push(ref(db, "couponRedemptions"));

  const payload = {
    customerId: customerId || "",
    couponCode: cleanCoupon,
    campaignId: campaignId || "",
    orderId: orderId || "",
    amount: Number(amount || 0),
    discountAmount: Number(discountAmount || 0),
    tableNumber: tableNumber || "",
    redeemedAt: crmAdvNow(),
    redeemedBy: actor.id,
    redeemedByName: actor.name
  };

  await set(redemptionRef, payload);

  if (campaignId) {
    const campaignSnap = await get(ref(db, `campaigns/${campaignId}`));
    if (campaignSnap.exists()) {
      const current = campaignSnap.val() || {};
      await update(ref(db, `campaigns/${campaignId}`), {
        redeemedCount: Number(current.redeemedCount || 0) + 1,
        updatedAt: crmAdvNow()
      });
    }
  }

  if (customerId) {
    const customerKey = crmAdvSafeKey(customerId);
    const customerPromoRef = push(ref(db, `customerCouponHistory/${customerKey}`));
    await set(customerPromoRef, payload);
  }

  if (orderId) {
    await window.createOrderTimelineEvent(orderId, "coupon_redeemed", {
      couponCode: cleanCoupon,
      campaignId,
      discountAmount: Number(discountAmount || 0)
    });
  }

  await crmAdvAudit(
    "marketing",
    "coupon_redeem",
    cleanCoupon,
    t("audit_coupon_redeemed"),
    payload,
    "info"
  );

  crmAdvNotify(t("coupon_redemption_tracked"));
  return redemptionRef.key;
};

/* ==============================
  COMPLAINTS
============================== */
window.createComplaintTicket = async function ({
  feedbackId = "",
  orderId = "",
  tableNumber = "",
  customerId = "",
  title = "",
  description = "",
  priority = "medium",
  source = "feedback"
} = {}) {
  const finalTitle = String(title || "").trim() || t("default_complaint_title");
  const finalDescription = String(description || "").trim() || t("no_description_label");
  const actor = crmAdvActor();
  const complaintRef = push(ref(db, "complaints"));

  const payload = {
    feedbackId: feedbackId || "",
    orderId: orderId || "",
    tableNumber: tableNumber || "",
    customerId: customerId || "",
    title: finalTitle,
    description: finalDescription,
    priority,
    source,
    status: "new",
    ownerId: "",
    ownerName: "",
    resolutionNote: "",
    createdAt: crmAdvNow(),
    createdBy: actor.id,
    createdByName: actor.name
  };

  await set(complaintRef, payload);

  if (feedbackId) {
    await update(ref(db, `feedback/${feedbackId}`), {
      complaintId: complaintRef.key,
      complaintStatus: "new"
    });
  }

  if (orderId) {
    await window.createOrderTimelineEvent(orderId, "complaint_created", {
      complaintId: complaintRef.key,
      priority,
      title: finalTitle
    });
  }

  await crmAdvAudit(
    "complaints",
    "create",
    complaintRef.key,
    t("audit_complaint_created"),
    payload,
    "warning"
  );

  crmAdvNotify(t("complaint_created_success"), "warning");
  return complaintRef.key;
};

/* ==============================
  COMPLAINT OWNER ASSIGN
============================== */
window.assignComplaintOwner = async function (complaintId, staffId) {
  if (!complaintId || !staffId) {
    alert(t("complaint_id_staff_id_required"));
    return;
  }

  const userSnap = await get(ref(db, `users/${staffId}`));

  if (!userSnap.exists()) {
    alert(t("staff_not_found"));
    return;
  }

  const user = userSnap.val() || {};

  const updates = {
    ownerId: staffId,
    ownerName: user.name || "",
    status: "in_progress",
    assignedAt: crmAdvNow(),
    updatedAt: crmAdvNow()
  };

  await update(ref(db, `complaints/${complaintId}`), updates);

  const complaintSnap = await get(ref(db, `complaints/${complaintId}`));
  const complaint = complaintSnap.exists() ? complaintSnap.val() : null;

  if (complaint?.orderId) {
    await window.createOrderTimelineEvent(complaint.orderId, "complaint_owner_assigned", {
      complaintId,
      ownerId: staffId,
      ownerName: user.name || ""
    });
  }

  await crmAdvAudit(
    "complaints",
    "assign_owner",
    complaintId,
    t("audit_complaint_owner_assigned"),
    { ownerId: staffId, ownerName: user.name || "" },
    "info"
  );

  crmAdvNotify(t("complaint_owner_assigned"));
};

/* ==============================
  ORDER TIMELINE
============================== */
window.createOrderTimelineEvent = async function createOrderTimelineEvent(
  orderId,
  eventType,
  payload = {}
) {
  if (!orderId || !eventType) return null;

  const eventRef = push(ref(db, `orderTimeline/${orderId}`));

  const data = {
    orderId,
    eventType,
    payload,
    actorId: crmAdvActor().id,
    actorName: crmAdvActor().name,
    actorRole: crmAdvActor().role,
    createdAt: crmAdvNow()
  };

  await set(eventRef, data);

  try {
    await update(ref(db, `orders/${orderId}`), {
      lastTimelineEventAt: crmAdvNow(),
      lastTimelineEventType: eventType
    });
  } catch (e) {
    console.warn(t("timeline_order_update_skipped_log"), e);
  }

  return eventRef.key;
};

window.addToStopList = async function (productId, productName) {
  await update(ref(db, `stopList/${productId}`), { name: productName, active: true, addedAt: Date.now(), addedBy: "admin" });
  showToast(t("stop_list_added").replace("{name}", productName), "warning");
};

window.removeFromStopList = async function (productId) {
  await remove(ref(db, `stopList/${productId}`));
  showToast(t("product_reactivated"), "success");
};

function applyAdminPageTranslations() {
  document.title = t("admin_document_title");
}

document.addEventListener("DOMContentLoaded", init);

function init() {
  console.log(t("admin_init_log"));
  applyLang();
  applyAdminPageTranslations();
  renderCategories(categorySelect);
  renderCategories(editCategory);
  initOrderCategoryFilter();
  renderOrderFilters();
  updateFullscreenButton();
  listenStaff();
  listenMenu();
  listenOrders();
  listenPaymentNotifications();
  listenTablesRealtime();
  setInterval(updateRealTimeStats, 30000);
  showSection("dashboard");
  startNotificationsAutoRefresh();
}

onLangChange(() => {
  applyLang();
  applyAdminPageTranslations();
  updateFullscreenButton();
  renderCategories(categorySelect, categorySelect?.value || "");
  renderCategories(editCategory, editCategory?.value || "");
  renderSubcategories(
    subcategorySelect,
    categorySelect?.value || "",
    subcategorySelect?.value || ""
  );
  renderSubcategories(
    editSubCategory,
    editCategory?.value || "",
    editSubCategory?.value || ""
  );
  renderOrderFilters();
  renderMenu();
  renderOrders(window.allOrders);

  const activeLink = document.querySelector(".sidebar-nav a.active");
  const activeId = activeLink?.getAttribute("href")?.replace("#", "") || "dashboard";
  loadSectionData(activeId);
});