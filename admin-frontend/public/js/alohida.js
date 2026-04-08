// SOCKET.IO FRONTEND INTEGRATION
// Ushbu kodni index.html yoki alohida js faylingizga qo'shing
// Server URL: o'zingizning backend domeningizni qo'ying

// SOCKETGA ULANISH
const socket = io("https://YOUR_BACKEND_URL", {
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
});

// ULANDI
socket.on("connect", () => {
  console.log("Socket.io ulandi: ", socket.id);
});

// XATO
socket.on("connect_error", (err) => {
  console.error("Socket ulanish xatosi: ", err);
});

// === BUYURTMA YUBORISH (CLIENT → SERVER) ===
function sendOrderToKitchen(orderData) {
  socket.emit("newOrder", orderData);
}

// === OSHPAZ SAXIFASIDAN YANGILANGAN STATUSNI QABUL QILISH ===
socket.on("orderStatusUpdate", (data) => {
  console.log("Buyurtma statusi yangilandi", data);

  // Masalan client sahifasida statusni yangilash:
  const item = document.querySelector(`#order-${data.id} .status`);
  if (item) {
    item.textContent = data.status;
  }

  // Agar modalda ko‘rsatilsa
  updateClientOrderStatusUI(data.id, data.status);
});

// === CLIENT-DAGI BUYURTMA STATUS YANGILOVCHI FUNKSIYA ===
function updateClientOrderStatusUI(orderId, status) {
  const el = document.querySelector(`[data-order='${orderId}'] .order-status`);
  if (el) el.textContent = status;
}
