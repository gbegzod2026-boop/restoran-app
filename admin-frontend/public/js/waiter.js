// waiter.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  update,
  remove,
  push,
  set,
  get
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

/* =========================
   FIREBASE
========================= */
const firebaseConfig = {
  databaseURL: "https://restoran-30d51-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

/* =========================
   ROLE CHECK
========================= */
if (localStorage.getItem("role") !== "waiter") {
  location.href = "login.html";
}

const waiterId = localStorage.getItem("waiterId");
const waiterName = localStorage.getItem("waiterName") || "Ofitsiant";

/* =========================
   ELEMENTS
========================= */
const readyBox = document.getElementById("readyOrders");
const deliveredBox = document.getElementById("deliveredOrders");
const newBadge = document.getElementById("newBadge");
const waiterCallsBox = document.getElementById("waiterCalls");
const cleaningBox = document.getElementById("cleaningAlerts");
const stockAlertBox = document.getElementById("stockAlerts");

/* =========================
   STATS
========================= */
const statTodayDelivered = document.getElementById("statTodayDelivered");
const statTotalDelivered = document.getElementById("statTotalDelivered");
const statTodayRevenue = document.getElementById("statTodayRevenue");
const statAvgOrder = document.getElementById("statAvgOrder");
const statTables = document.getElementById("statTables");
const statLoyalCustomers = document.getElementById("statLoyalCustomers");


const liveTablesBox = document.getElementById("liveTablesGrid");
const paymentRequestsBox = document.getElementById("paymentRequests");

const statActiveTables = document.getElementById("statActiveTables");
const statReadyToServe = document.getElementById("statReadyToServe");
const statBillsPending = document.getElementById("statBillsPending");
const statServedTodayExtra = document.getElementById("statServedTodayExtra");
const statServicePulse = document.getElementById("statServicePulse");

let ordersCache = {};
let tablesCache = {};
let paymentRequestsCache = {};
let chart;
let audioContext = null;

function isToday(ts) {
  if (!ts) return false;
  return new Date(ts).toDateString() === new Date().toDateString();
}

function getOrderSum(order) {
  return Object.values(order.items || {}).reduce((a, i) => a + (i.price * i.qty), 0);
}

function getTableNumberFromKey(tableId, table) {
  return table?.number ?? String(tableId).replace(/\D/g, "");
}

function getTableKeyByNumber(tableNumber) {
  return Object.keys(tablesCache).find((key) => {
    const t = tablesCache[key] || {};
    return String(getTableNumberFromKey(key, t)) === String(tableNumber);
  });
}

function getLatestOrderForTable(tableNumber) {
  const list = Object.entries(ordersCache)
    .filter(([, order]) => String(order.table) === String(tableNumber))
    .sort((a, b) => (b[1].updatedAt || b[1].createdAt || 0) - (a[1].updatedAt || a[1].createdAt || 0));

  return list[0] ? { id: list[0][0], ...list[0][1] } : null;
}

function getPaymentRequestForTable(tableNumber) {
  const list = Object.entries(paymentRequestsCache)
    .filter(([, req]) =>
      String(req.table) === String(tableNumber) &&
      !["approved", "paid", "done", "rejected", "cancelled"].includes(String(req.status || "").toLowerCase())
    )
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));

  return list[0] ? { id: list[0][0], ...list[0][1] } : null;
}

function normalizeTableStatus(tableId, table) {
  const raw = String(table?.status || "").toLowerCase();
  const tableNumber = getTableNumberFromKey(tableId, table);
  const latestOrder = getLatestOrderForTable(tableNumber);
  const paymentReq = getPaymentRequestForTable(tableNumber);

  if (["cleaning", "needs_cleaning"].includes(raw)) return "cleaning";
  if (paymentReq || raw === "billing") return "billing";
  if (raw === "reserved") return "reserved";
  if (raw === "seated") return "seated";
  if (raw === "ordered") return "ordered";
  if (raw === "cooking") return "cooking";
  if (raw === "ready") return "ready";
  if (raw === "eating") return "eating";
  if (raw === "free" || raw === "available") return "free";

  if (latestOrder) {
    const os = String(latestOrder.status || latestOrder.statusKey || "").toLowerCase();

    if (["tayyor", "ready"].includes(os)) return "ready";
    if (["yetkazilmoqda", "picked_up", "serving"].includes(os)) return "ready";
    if (["yetkazildi", "served"].includes(os)) return "eating";
    if (["tasdiqlandi", "tayyorlanmoqda", "cooking", "accepted", "in_kitchen"].includes(os)) return "cooking";
    if (["yangi", "new", "ordered"].includes(os)) return "ordered";
  }

  return "free";
}

function getStatusLabel(status) {
  return {
    free: "Bo'sh",
    reserved: "Bron",
    seated: "O'tirgan",
    ordered: "Buyurtma olingan",
    cooking: "Tayyorlanmoqda",
    ready: "Ready for Pickup",
    eating: "Ovqatlanmoqda",
    billing: "Hisob jarayoni",
    cleaning: "Tozalanmoqda"
  }[status] || status;
}

function getServicePulse(activeTables, readyToServe, billsPending) {
  const score = activeTables + (readyToServe * 2) + (billsPending * 2);

  if (score >= 10) return "🔴 Juda band";
  if (score >= 5) return "🟠 Band";
  return "🟢 Sokin";
}

/* =========================
   AUDIO NOTIFICATION
========================= */
function initAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playNotificationSound() {
  initAudio();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.3);

  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.5);

  // Ikkinchi tovush (ikki tovushli signal)
  setTimeout(() => {
    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.connect(gain2);
    gain2.connect(audioContext.destination);
    osc2.frequency.setValueAtTime(600, audioContext.currentTime);
    gain2.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    osc2.start(audioContext.currentTime);
    osc2.stop(audioContext.currentTime + 0.3);
  }, 200);
}

/* =========================
   TOAST NOTIFICATION
========================= */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-content">
      <span class="toast-icon">${type === 'success' ? '✅' : type === 'warning' ? '⚠️' : type === 'error' ? '❌' : 'ℹ️'}</span>
      <span class="toast-message">${message}</span>
    </div>
  `;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 100);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/* =========================
   LOYALTY SYSTEM
========================= */
async function checkLoyalty(customerPhone) {
  if (!customerPhone) return { discount: 0, visits: 0 };

  const loyaltyRef = ref(db, `loyalty/${customerPhone}`);
  const snapshot = await get(loyaltyRef);
  const data = snapshot.val() || { visits: 0, totalSpent: 0 };

  const visits = data.visits || 0;
  let discount = 0;

  if (visits >= 20) discount = 15;
  else if (visits >= 10) discount = 10;
  else if (visits >= 5) discount = 5;

  return { discount, visits: visits + 1 };
}

async function applyLoyaltyDiscount(orderId, customerPhone, totalAmount) {
  const loyalty = await checkLoyalty(customerPhone);
  if (loyalty.discount > 0) {
    const discountAmount = (totalAmount * loyalty.discount) / 100;
    const finalAmount = totalAmount - discountAmount;

    await update(ref(db, `orders/${orderId}`), {
      originalAmount: totalAmount,
      discountPercent: loyalty.discount,
      discountAmount: discountAmount,
      finalAmount: finalAmount,
      customerPhone: customerPhone,
      loyaltyApplied: true
    });

    // Yangilash visits count
    await update(ref(db, `loyalty/${customerPhone}`), {
      visits: loyalty.visits,
      lastVisit: Date.now(),
      totalSpent: (loyalty.totalSpent || 0) + finalAmount
    });

    showToast(`🎉 Mijozga ${loyalty.discount}% chegirma qo'llandi!`, 'success');
    return finalAmount;
  }
  return totalAmount;
}

/* =========================
   STOCK MANAGEMENT (STOP-LIST)
========================= */
function checkStockAvailability(items) {
  return new Promise((resolve) => {
    onValue(ref(db, "stopList"), (snap) => {
      const stopList = snap.val() || {};
      const unavailableItems = [];

      Object.entries(items).forEach(([itemId, item]) => {
        if (stopList[itemId] && stopList[itemId].active) {
          unavailableItems.push(item.name || itemId);
        }
      });

      resolve(unavailableItems);
    }, { onlyOnce: true });
  });
}

function listenStockAlerts() {
  onValue(ref(db, "inventoryAlerts"), (snap) => {
    const alerts = snap.val() || {};
    stockAlertBox.innerHTML = '';

    Object.entries(alerts).forEach(([id, alert]) => {
      if (!alert.acknowledged) {
        stockAlertBox.innerHTML += `
          <div class="alert-card alert-warning">
            <div class="alert-icon">⚠️</div>
            <div class="alert-content">
              <h4>Zaxira ogohlantirishi</h4>
              <p><strong>${alert.productName}</strong> kam qoldi!</p>
              <p>Qoldiq: ${alert.currentStock} ${alert.unit}</p>
              <small>${new Date(alert.timestamp).toLocaleTimeString('uz-UZ')}</small>
            </div>
            <button onclick="acknowledgeStockAlert('${id}')" class="btn-ack">✓</button>
          </div>
        `;
      }
    });
  });
}

window.acknowledgeStockAlert = async function (alertId) {
  await update(ref(db, `inventoryAlerts/${alertId}`), {
    acknowledged: true,
    acknowledgedBy: waiterId,
    acknowledgedAt: Date.now()
  });
  showToast('Ogohlantirish o\'qildi', 'success');
};

/* =========================
   WAITER CALL SYSTEM
========================= */
function listenWaiterCalls() {
  onValue(ref(db, "waiterCalls"), (snap) => {
    const calls = snap.val() || {};
    let hasNewCall = false;

    Object.entries(calls).forEach(([id, call]) => {
      if (call.status === "waiting" && !call.notified) {
        hasNewCall = true;
        playNotificationSound();
        showToast(`🛎 Stol ${call.table} - Ofitsiant chaqirmoqda!`, 'warning');

        // Mark as notified
        update(ref(db, `waiterCalls/${id}`), { notified: true });
      }
    });

    renderWaiterCalls(calls);
  });
}

function renderWaiterCalls(calls) {
  if (!waiterCallsBox) return;

  waiterCallsBox.innerHTML = '';
  let activeCalls = 0;

  Object.entries(calls).forEach(([id, call]) => {
    if (call.status === "waiting" || call.status === "acknowledged") {
      activeCalls++;
      const isUrgent = Date.now() - (call.timestamp || 0) > 60000; // 1 daqiqadan ko'p bo'lsa

      waiterCallsBox.innerHTML += `
        <div class="waiter-call-card ${isUrgent ? 'urgent' : ''} ${call.status}">
          <div class="call-header">
            <span class="table-number">🪑 Stol ${call.table}</span>
            <span class="call-time">${new Date(call.timestamp).toLocaleTimeString('uz-UZ')}</span>
          </div>
          <div class="call-body">
            <p>${call.message || 'Ofitsiant chaqirmoqda'}</p>
            ${call.type === 'payment' ? '💰 To\'lov' : ''}
            ${call.type === 'order' ? '📝 Buyurtma' : ''}
            ${call.type === 'help' ? '❓ Yordam' : ''}
          </div>
          <div class="call-actions">
            ${call.status === 'waiting' ? `
              <button onclick="acknowledgeCall('${id}')" class="btn-acknowledge">
                📋 Qabul qilish
              </button>
            ` : `
              <button onclick="resolveCall('${id}')" class="btn-resolve">
                ✅ Hal qilish
              </button>
            `}
          </div>
        </div>
      `;
    }
  });

  if (activeCalls > 0) {
    newBadge.classList.remove("hidden");
    newBadge.textContent = activeCalls;
  }
}

window.acknowledgeCall = async function (callId) {
  await update(ref(db, `waiterCalls/${callId}`), {
    status: "acknowledged",
    acknowledgedBy: waiterId,
    acknowledgedAt: Date.now()
  });
  showToast('Chaqiruv qabul qilindi', 'success');
};

window.resolveCall = async function (callId) {
  await update(ref(db, `waiterCalls/${callId}`), {
    status: "resolved",
    resolvedBy: waiterId,
    resolvedAt: Date.now()
  });
  showToast('Chaqiruv yopildi', 'success');
};

function listenTablesLive() {
  onValue(ref(db, "tables"), (snap) => {
    tablesCache = snap.val() || {};
    renderLiveTables();
  });
}

function renderLiveTables() {
  if (!liveTablesBox) return;

  const tables = tablesCache || {};
  const entries = Object.entries(tables);

  if (!entries.length) {
    liveTablesBox.innerHTML = `<p class="empty-state">Stollar topilmadi</p>`;
    return;
  }

  liveTablesBox.innerHTML = "";

  let activeTables = 0;
  let readyToServe = 0;
  let billsPending = 0;

  entries
    .sort((a, b) => {
      const an = Number(getTableNumberFromKey(a[0], a[1]));
      const bn = Number(getTableNumberFromKey(b[0], b[1]));
      return an - bn;
    })
    .forEach(([tableId, table]) => {
      const tableNumber = getTableNumberFromKey(tableId, table);
      const status = normalizeTableStatus(tableId, table);
      const latestOrder = getLatestOrderForTable(tableNumber);
      const paymentReq = getPaymentRequestForTable(tableNumber);

      if (!["free", "reserved", "cleaning"].includes(status)) activeTables++;
      if (status === "ready") readyToServe++;
      if (status === "billing") billsPending++;

      liveTablesBox.innerHTML += `
        <div class="order-card table-card ${status}">
          <div class="order-info">
            <h3>🪑 Stol ${tableNumber}</h3>
            <p><strong>Status:</strong> ${getStatusLabel(status)}</p>
            <p><strong>Waiter:</strong> ${table.currentWaiterName || waiterName || "—"}</p>
            <p><strong>Order:</strong> ${latestOrder ? (latestOrder.orderNumber || latestOrder.status || "Aktiv") : "Yo'q"}</p>
            ${paymentReq ? `<p class="text-warning"><strong>Payment:</strong> ${paymentReq.status || "requested"}</p>` : ""}
            <div class="call-actions" style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
              <button onclick="seatGuests('${tableId}')" class="btn-acknowledge">Seat Guests</button>
              <button onclick="requestBill('${tableId}', '${tableNumber}')" class="btn-ack">Request Bill</button>
              <button onclick="startCleaning('${tableId}')" class="btn-start-clean">Clean</button>
              <button onclick="markTableFree('${tableId}')" class="btn-resolve">Mark Free</button>
            </div>
          </div>
        </div>
      `;
    });

  if (statActiveTables) statActiveTables.innerText = activeTables;
  if (statReadyToServe) statReadyToServe.innerText = readyToServe;
  if (statBillsPending) statBillsPending.innerText = billsPending;
  if (statServicePulse) statServicePulse.innerText = getServicePulse(activeTables, readyToServe, billsPending);
}

/* =========================
   CLEANING SIGNALIZATION
========================= */
function listenCleaningAlerts() {
  onValue(ref(db, "tables"), (snap) => {
    const tables = snap.val() || {};
    if (!cleaningBox) return;

    cleaningBox.innerHTML = '';
    let needsCleaning = 0;

    Object.entries(tables).forEach(([tableId, table]) => {
      if (table.status === "needs_cleaning") {
        needsCleaning++;
        cleaningBox.innerHTML += `
          <div class="cleaning-card">
            <div class="table-info">
              <h4>🪑 Stol ${table.number}</h4>
              <span class="status-badge status-dirty">Tozalanishi kerak</span>
            </div>
            <div class="cleaning-actions">
              <button onclick="startCleaning('${tableId}')" class="btn-start-clean">
                🧹 Tozalashni boshlash
              </button>
            </div>
          </div>
        `;
      } else if (table.status === "cleaning") {
        cleaningBox.innerHTML += `
          <div class="cleaning-card in-progress">
            <div class="table-info">
              <h4>🪑 Stol ${table.number}</h4>
              <span class="status-badge status-cleaning">Tozalanmoqda</span>
              <small>By: ${table.cleaningBy || 'Unknown'}</small>
            </div>
            <div class="cleaning-actions">
              <button onclick="finishCleaning('${tableId}')" class="btn-finish-clean">
                ✨ Tayyor
              </button>
            </div>
          </div>
        `;
      }
    });

    if (needsCleaning > 0) {
      showToast(`${needsCleaning} ta stol tozalanishi kerak`, 'warning');
    }
  });
}

window.seatGuests = async function (tableId) {
  await update(ref(db, `tables/${tableId}`), {
    status: "seated",
    seatedAt: Date.now(),
    currentWaiterId: waiterId,
    currentWaiterName: waiterName
  });

  showToast("Mehmonlar stolga o'tkazildi", "success");
};

window.markTableFree = async function (tableId) {
  await update(ref(db, `tables/${tableId}`), {
    status: "free",
    activeOrderId: null,
    billRequestedAt: null,
    currentWaiterId: null,
    currentWaiterName: null,
    lastFreedAt: Date.now(),
    freedBy: waiterName
  });

  showToast("Stol bo'shatildi", "success");
};

window.startCleaning = async function (tableId) {
  await update(ref(db, `tables/${tableId}`), {
    status: "cleaning",
    cleaningBy: waiterName,
    cleaningStartedAt: Date.now()
  });
  showToast('Tozalash boshlandi', 'info');
};

window.finishCleaning = async function (tableId) {
  await update(ref(db, `tables/${tableId}`), {
    status: "free",
    cleaningBy: null,
    cleaningStartedAt: null,
    lastCleanedAt: Date.now(),
    cleanedBy: waiterName,
    currentWaiterId: null,
    currentWaiterName: null
  });
  showToast('Stol tozalandi va tayyor!', 'success');
};

/* =========================
   REALTIME ORDERS
========================= */
onValue(ref(db, "orders"), async (snap) => {
  ordersCache = snap.val() || {};
  const orders = ordersCache;
  const stopListSnap = await get(ref(db, "stopList"));
  const stopList = stopListSnap.val() || {};

  readyBox.innerHTML = "";
  deliveredBox.innerHTML = "";

  let todayDelivered = 0;
  let totalDelivered = 0;
  let todayRevenue = 0;
  let totalRevenue = 0;
  let notDelivered = 0;
  let delivered = 0;
  let hasReady = false;

  const tablesSet = new Set();
  const today = new Date().toDateString();
  const loyalCustomers = new Set();

  for (const [id, order] of Object.entries(orders)) {
    if (!order.items) continue;

    // Stop-list tekshiruvi
    const unavailableItems = [];
    Object.entries(order.items).forEach(([itemId, item]) => {
      if (stopList[itemId]?.active) {
        unavailableItems.push(item.name || itemId);
      }
    });

    if (unavailableItems.length > 0 && order.status === "Yangi") {
      // Buyurtmada tugagan mahsulot bor - ogohlantirish
      showToast(`⚠️ Buyurtma #${id.slice(-4)}: ${unavailableItems.join(', ')} tugagan!`, 'error');
    }

    const sum = Object.values(order.items)
      .reduce((a, i) => a + i.price * i.qty, 0);

    // Loyallik tizimi tekshiruvi
    if (order.customerPhone && order.status === "Yetkazildi") {
      loyalCustomers.add(order.customerPhone);
    }

    if (order.status === "Tayyor") {
      notDelivered++;
      hasReady = true;

      const firstItem = Object.values(order.items)[0];
      const img = firstItem?.img || "img/food.png";

      readyBox.innerHTML += `
        <div class="order-card waiting ${unavailableItems.length > 0 ? 'has-issue' : ''}">
          <img src="${img}" onerror="this.src='img/food.png'">
          <div class="order-info">
            <h3>🪑 Stol ${order.table}</h3>
            <p>🍽 Ready for Pickup</p>
            ${unavailableItems.length > 0 ? `<p class="text-danger">❌ Tugagan: ${unavailableItems.join(', ')}</p>` : ''}
            ${order.loyaltyApplied ? `<p class="text-success">🎉 ${order.discountPercent}% chegirma</p>` : ''}
            <p>💰 ${sum.toLocaleString()} so'm</p>
            <button onclick="setStatus('${id}','Yetkazilmoqda')" class="btn-pickup">
              🚶 Pickup
            </button>
          </div>
        </div>
      `;
    }

    if (order.status === "Yetkazilmoqda") {
      notDelivered++;
      hasReady = true;

      const firstItem = Object.values(order.items)[0];
      const img = firstItem?.img || "img/food.png";

      readyBox.innerHTML += `
        <div class="order-card delivering">
          <img src="${img}" onerror="this.src='img/food.png'">
          <div class="order-info">
            <h3>🪑 Stol ${order.table}</h3>
            <p>🚶 Buyurtma yetkazilmoqda</p>
            <p>💰 ${sum.toLocaleString()} so'm</p>
            <button onclick="setStatus('${id}','Yetkazildi')" class="btn-deliver">
              ✅ Served
            </button>
          </div>
        </div>
      `;
    }

    if (order.status === "Yetkazildi") {
      delivered++;

      deliveredBox.innerHTML += `
        <div class="order-card delivered">
          <h3>🪑 Stol ${order.table}</h3>
          <p>💰 ${sum.toLocaleString()} so'm</p>
          ${order.loyaltyApplied ? `<small class="text-success">Chegirma: ${order.discountPercent}%</small>` : ''}
          <button class="btn-danger" onclick="deleteOrder('${id}')">
            🗑 O'chirish
          </button>
        </div>
      `;

      totalDelivered++;
      totalRevenue += order.finalAmount || sum;
      tablesSet.add(order.table);

      if (order.updatedAt && new Date(order.updatedAt).toDateString() === today) {
        todayDelivered++;
        todayRevenue += order.finalAmount || sum;
      }
    }
  }

  newBadge.classList.toggle("hidden", !hasReady);
  statTodayDelivered.innerText = todayDelivered;
  statTotalDelivered.innerText = totalDelivered;
  statTodayRevenue.innerText = todayRevenue.toLocaleString() + " so'm";
  statAvgOrder.innerText = totalDelivered
    ? Math.round(totalRevenue / totalDelivered).toLocaleString() + " so'm"
    : "0 so'm";
  statTables.innerText = tablesSet.size;
  if (statLoyalCustomers) statLoyalCustomers.innerText = loyalCustomers.size;

  drawChart(notDelivered, delivered);
});

/* =========================
   UPDATE STATUS
========================= */
window.setStatus = async (id, status) => {
  const orderRef = ref(db, `orders/${id}`);
  const orderSnap = await get(orderRef);
  const order = orderSnap.val();

  if (!order) return;

  const now = Date.now();
  const tableKey = getTableKeyByNumber(order.table) || `table_${order.table}`;

  if (status === "Yetkazilmoqda" && order.customerPhone && !order.loyaltyChecked) {
    const sum = getOrderSum(order);
    await applyLoyaltyDiscount(id, order.customerPhone, sum);
    await update(orderRef, { loyaltyChecked: true });
  }

  const payload = {
    status,
    updatedBy: waiterId,
    updatedAt: now
  };

  if (status === "Yetkazilmoqda") {
    payload.pickedUpAt = now;
    payload.pickedUpBy = waiterId;
    payload.pickedUpByName = waiterName;
  }

  if (status === "Yetkazildi") {
    payload.servedAt = now;
    payload.servedBy = waiterId;
    payload.servedByName = waiterName;
  }

  await update(orderRef, payload);

  if (status === "Yetkazilmoqda") {
    await update(ref(db, `tables/${tableKey}`), {
      status: "ready",
      readyForPickupAt: now,
      currentWaiterId: waiterId,
      currentWaiterName: waiterName,
      activeOrderId: id
    });

    showToast("Order pickup qilindi", "success");
  }

  if (status === "Yetkazildi") {
    await update(ref(db, `tables/${tableKey}`), {
      status: "eating",
      servedAt: now,
      currentWaiterId: waiterId,
      currentWaiterName: waiterName,
      activeOrderId: id
    });

    showToast("Order served qilindi, stol eating holatiga o'tdi", "success");
  }
};

/* =========================
   DELETE ORDER
========================= */
window.deleteOrder = async (id) => {
  if (!confirm("Buyurtma o'chirilsinmi?")) return;
  await remove(ref(db, `orders/${id}`));
  showToast('Buyurtma o\'chirildi', 'info');
};

function listenPaymentRequests() {
  onValue(ref(db, "paymentRequests"), (snap) => {
    paymentRequestsCache = snap.val() || {};
    renderPaymentRequests();
    renderLiveTables();
  });
}

function renderPaymentRequests() {
  if (!paymentRequestsBox) return;

  const requests = Object.entries(paymentRequestsCache || {})
    .filter(([, req]) => !["approved", "paid", "done", "rejected", "cancelled"].includes(String(req.status || "").toLowerCase()))
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));

  if (!requests.length) {
    paymentRequestsBox.innerHTML = `<p class="empty-state">Payment requestlar yo'q</p>`;
    return;
  }

  paymentRequestsBox.innerHTML = "";

  requests.forEach(([requestId, req]) => {
    paymentRequestsBox.innerHTML += `
      <div class="order-card delivered">
        <div class="order-info">
          <h3>💳 Stol ${req.table}</h3>
          <p><strong>Status:</strong> ${req.status || "requested"}</p>
          <p><strong>Method:</strong> ${req.method || "cash/card"}</p>
          <p><strong>Time:</strong> ${req.createdAt ? new Date(req.createdAt).toLocaleTimeString('uz-UZ') : "—"}</p>
          <div class="call-actions" style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
            <button onclick="markBillPresented('${requestId}', '${req.tableId || ""}')" class="btn-acknowledge">
              Bill Ready
            </button>
            <button onclick="approvePaymentRequest('${requestId}', '${req.tableId || ""}')" class="btn-resolve">
              Approve Payment
            </button>
          </div>
        </div>
      </div>
    `;
  });
}

window.requestBill = async function (tableId, tableNumber) {
  const alreadyOpen = Object.values(paymentRequestsCache || {}).some((req) =>
    String(req.table) === String(tableNumber) &&
    !["approved", "paid", "done", "rejected", "cancelled"].includes(String(req.status || "").toLowerCase())
  );

  if (alreadyOpen) {
    showToast("Bu stol uchun hisob allaqachon ochilgan", "warning");
    return;
  }

  const reqRef = push(ref(db, "paymentRequests"));
  await set(reqRef, {
    table: tableNumber,
    tableId,
    status: "requested",
    createdAt: Date.now(),
    requestedBy: waiterId,
    requestedByName: waiterName,
    source: "waiter"
  });

  await update(ref(db, `tables/${tableId}`), {
    status: "billing",
    billRequestedAt: Date.now(),
    currentWaiterId: waiterId,
    currentWaiterName: waiterName
  });

  showToast(`Stol ${tableNumber} uchun hisob so'rovi yuborildi`, "info");
};

window.markBillPresented = async function (requestId, tableId) {
  await update(ref(db, `paymentRequests/${requestId}`), {
    status: "bill_presented",
    billPresentedAt: Date.now(),
    billPresentedBy: waiterId,
    billPresentedByName: waiterName
  });

  if (tableId) {
    await update(ref(db, `tables/${tableId}`), {
      status: "billing",
      billPresentedAt: Date.now()
    });
  }

  showToast("Hisob mijozga olib borildi", "success");
};

window.approvePaymentRequest = async function (requestId, tableId) {
  const req = paymentRequestsCache[requestId];
  if (!req) return;

  await update(ref(db, `paymentRequests/${requestId}`), {
    status: "approved",
    approvedAt: Date.now(),
    approvedBy: waiterId,
    approvedByName: waiterName
  });

  const latestOrder = getLatestOrderForTable(req.table);

  if (latestOrder) {
    await update(ref(db, `orders/${latestOrder.id}`), {
      paymentStatus: "paid",
      paidAt: Date.now(),
      paidBy: waiterId,
      paidByName: waiterName
    });
  }

  const tableKey = tableId || getTableKeyByNumber(req.table);
  if (tableKey) {
    await update(ref(db, `tables/${tableKey}`), {
      status: "cleaning",
      paymentCompletedAt: Date.now(),
      currentWaiterId: waiterId,
      currentWaiterName: waiterName
    });
  }

  showToast(`Stol ${req.table} to'lovi tasdiqlandi`, "success");
};

/* =========================
   CHART
========================= */
function drawChart(notDelivered, delivered) {
  const canvas = document.getElementById("waiterChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  if (chart) {
    chart.destroy();
  }

  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["🚶 Yetkazilmagan", "✅ Yetkazilgan"],
      datasets: [
        {
          label: "Buyurtmalar holati",
          data: [notDelivered, delivered],
          backgroundColor: ["#ff9800", "#2ecc71"],
          borderRadius: 10,
          barThickness: 40
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0 }
        }
      }
    }
  });
}

function renderWaiterOrders(orders) {
  const waiterBox = document.getElementById("waiterOrders");
  if (!waiterBox) return;

  waiterBox.innerHTML = "";

  Object.entries(orders || {}).forEach(([orderId, order]) => {
    const status = String(order.statusKey || order.status || "").trim().toLowerCase();

    if (status !== "tayyor") return;
    if (order.tableClosed) return;

    waiterBox.innerHTML += `
      <div class="waiter-card">
        <h3>🪑 Stol ${order.table}</h3>
        <p>📦 Buyurtma #${order.orderNumber || orderId.slice(-4)}</p>
        <p>🍽 Tayyor</p>
        <button onclick="deliverOrder('${orderId}', '${order.table}')">
          Yetkazildi
        </button>
      </div>
    `;
  });
}

function listenReadyOrdersForWaiter() {
  onValue(ref(db, "orders"), snap => {
    const orders = snap.val() || {};
    renderWaiterOrders(orders);
  });
}

window.deliverOrder = async function (orderId, table) {
  const now = Date.now();

  await update(ref(db, "orders/" + orderId), {
    status: "yopildi",
    statusKey: "yopildi",
    statusLabel: "Yopildi",
    deliveredAt: now
  });

  await update(ref(db, "tables/" + table), {
    status: "free",
    orderId: null,
    busy: false
  });
};

/* =========================
   INITIALIZATION
========================= */
document.addEventListener('DOMContentLoaded', () => {
  listenWaiterCalls();
  listenCleaningAlerts();
  listenStockAlerts();
  listenTablesLive();
  listenPaymentRequests();
  renderLiveTables();
  renderPaymentRequests();
  listenWaiterCalls();
  listenCleaningAlerts();
  listenStockAlerts();

  // Audio context ni ishga tushirish uchun bir marta click kerak
  document.addEventListener('click', initAudio, { once: true });
});