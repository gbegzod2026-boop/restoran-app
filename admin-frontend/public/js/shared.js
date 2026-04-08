// Shared.js
// ==============================
// 🔹 IMPORTS
// ==============================
import { ref, onValue, remove, push, set, update, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { t, getLang } from "./i18n.js";

// ==============================
// 🔹 GLOBAL STATUS KONSTANTALARI (Muhim!)
// ==============================
export const ORDER_STATUS = {
  QUEUE: 'queue',       // Navbatda
  NEW: 'new',           // Yangi (Oshpazga biriktirilganda)
  APPROVED: 'approved', // Tasdiqlangan
  COOKING: 'cooking',   // Tayyorlanmoqda
  READY: 'ready',       // Tayyor
  CLOSED: 'closed'      // Yopilgan
};

export const TABLE_STATUS = {
  OPEN: 'open',
  BUSY: 'busy',
  CLEANING: 'cleaning'
};

// To'lovni tekshirish uchun yagona funksiya
export function isPaymentValid(paymentData) {
  if (!paymentData) return false;
  return paymentData.paid === true || paymentData.approved === true;
}

// ==============================
// 🔥 FOODIFY SHARED API
// ==============================
export const FoodifyShared = {
  async addMenu(data) {
    const newRef = push(ref(db, "menu"));
    await set(newRef, data);
  },

  async updateMenu(id, data) {
    await update(ref(db, "menu/" + id), data);
  },

  async deleteMenu(id) {
    await remove(ref(db, "menu/" + id));
  },

  subscribeMenu(callback) {
    onValue(ref(db, "menu"), snap => {
      const data = snap.val() || {};
      const menuArray = Object.entries(data).map(([id, item]) => ({ id, ...item }));
      callback(menuArray);
    });
  },

  subscribeOrders(callback) {
    onValue(ref(db, "orders"), snap => {
      const data = snap.val() || {};
      const ordersArray = Object.entries(data).map(([id, item]) => ({ id, ...item }));
      callback(ordersArray);
    });
  },

  async getMenu() {
    const snap = await get(ref(db, "menu"));
    return snap.val() || {};
  }
};

// ==============================
// 🔹 CATEGORY DATA
// ==============================
export const CATEGORY_DATA = {
  categories: [
    { id: "main", nameKey: "cat_main", sub: ["sub_meat", "sub_chicken", "sub_fish", "sub_national"] },
    { id: "snacks", nameKey: "cat_snacks", sub: ["sub_salads", "sub_small_snacks", "sub_cold_snacks", "sub_hot_snacks"] },
    { id: "soups", nameKey: "cat_soups", sub: ["sub_national_soups", "sub_broths", "sub_cream_soups"] },
    { id: "fastfood", nameKey: "cat_fastfood", sub: ["sub_burgers", "sub_hotdog", "sub_sandwich", "sub_shawarma"] },
    { id: "garnish", nameKey: "cat_garnish", sub: ["sub_potato", "sub_veggie_garnish", "sub_rice_pasta"] },
    { id: "drinks", nameKey: "cat_drinks", sub: ["sub_hot_drinks", "sub_cold_drinks", "sub_soda", "sub_juices"] },
    { id: "dessert", nameKey: "cat_dessert", sub: ["sub_cakes", "sub_pastry", "sub_icecream", "sub_sweets"] },
    { id: "bread", nameKey: "cat_bread", sub: ["sub_bread", "sub_lavash", "sub_round_bread", "sub_baguette"] },
    { id: "special", nameKey: "cat_special", sub: ["sub_kids", "sub_diet", "sub_vegan", "sub_sport"] },
    { id: "combo", nameKey: "category_combo", sub: ["fast_food", "family_combo", "lunch"] }, // 🔴 KOMBO QO'SHILDI
    { id: "fastfood", nameKey: "category_fastfood", sub: ["burger", "pizza", "hotdog"] },
    { id: "drinks", nameKey: "category_drinks", sub: ["cold", "hot"] },
  ]
};