// server.js - To'liq Real-time Socket.io Server
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

/* ================== CONFIG ================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

/* ================== SOCKET.IO ================== */
const io = new Server(server, {
  cors: { 
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Xonalar va tracking
const rooms = {
  clients: new Map(),      // clientId -> socketId
  chefs: new Map(),        // chefId -> socketId
  tables: new Map(),       // tableNumber -> Set(socketIds)
  orders: new Map()        // orderId -> { chefId, table, status }
};

io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);

  /* ========== AUTH & ROOMS ========== */
  
  // Client ulanishi
  socket.on("client-connect", (data) => {
    const { clientId, table } = data;
    
    socket.clientId = clientId;
    socket.table = table;
    socket.role = 'client';
    
    rooms.clients.set(clientId, socket.id);
    
    if (table) {
      socket.join(`table-${table}`);
      if (!rooms.tables.has(table)) {
        rooms.tables.set(table, new Set());
      }
      rooms.tables.get(table).add(socket.id);
    }
    
    console.log(`👤 Client connected: ${clientId}, Table: ${table}`);
  });

  // Chef ulanishi
  socket.on("chef-connect", (data) => {
    const { chefId, name } = data;
    
    socket.chefId = chefId;
    socket.chefName = name;
    socket.role = 'chef';
    
    rooms.chefs.set(chefId, socket.id);
    socket.join('chefs'); // Barcha oshpazlar xonasi
    
    console.log(`👨‍🍳 Chef connected: ${name} (${chefId})`);
    
    // Faol buyurtmalarni yuborish
    broadcastActiveOrders(chefId);
  });

  // Admin ulanishi
  socket.on("admin-connect", (data) => {
    socket.role = 'admin';
    socket.join('admins');
    console.log(`🔴 Admin connected: ${socket.id}`);
  });

  /* ========== ORDER EVENTS ========== */
  
  // Yangi buyurtma yaratildi
  socket.on("new-order", (data) => {
    const { orderId, order } = data;
    
    rooms.orders.set(orderId, {
      chefId: null,
      table: order.table,
      status: order.status,
      clientId: socket.clientId
    });
    
    // Barcha oshpazlarga yuborish
    io.to('chefs').emit("new-order", {
      orderId,
      order,
      timestamp: Date.now()
    });
    
    // Clientga tasdiqlash
    socket.emit("order-created", { orderId, status: 'created' });
    
    console.log(`📦 New order: #${order.orderNumber}, Table: ${order.table}`);
  });

  // Buyurtma taqsimlandi
  socket.on("order-assigned", (data) => {
    const { orderId, chefId, table } = data;
    
    const orderData = rooms.orders.get(orderId) || {};
    orderData.chefId = chefId;
    rooms.orders.set(orderId, orderData);
    
    // Tanlangan chefga
    const chefSocketId = rooms.chefs.get(chefId);
    if (chefSocketId) {
      io.to(chefSocketId).emit("order-assigned", data);
    }
    
    // Table dagi clientlarga
    io.to(`table-${table}`).emit("order-accepted", {
      orderId,
      status: 'Tasdiqlandi',
      chefId
    });
    
    console.log(`✅ Order ${orderId} assigned to chef ${chefId}`);
  });

  // Status o'zgarishi (Chef tomonidan)
  socket.on("chef-status-update", (data) => {
    const { orderId, status, chefId, table, orderNumber } = data;
    
    // Order tracking yangilash
    const orderData = rooms.orders.get(orderId) || {};
    orderData.status = status;
    rooms.orders.set(orderId, orderData);
    
    // Clientga yuborish (stol bo'yicha)
    io.to(`table-${table}`).emit("order-status-update", {
      orderId,
      status,
      statusKey: mapStatus(status),
      chefId,
      chefName: socket.chefName,
      orderNumber,
      timestamp: Date.now()
    });
    
    // Boshqa oshpazlarga xabar (real-time sinxronlashish uchun)
    socket.to('chefs').emit("other-chef-status", {
      orderId,
      status,
      chefId,
      chefName: socket.chefName
    });
    
    // Adminlarga xabar
    io.to('admins').emit("order-status-changed", data);
    
    console.log(`🔄 Order ${orderId} status: ${status}`);
  });

  /* ========== PAYMENT EVENTS ========== */
  
  // To'lov so'rovi (Client)
  socket.on("payment-request", (data) => {
    const { orderId, amount, method, table } = data;
    
    // Adminlarga yuborish
    io.to('admins').emit("payment-request", {
      ...data,
      clientId: socket.clientId,
      timestamp: Date.now()
    });
    
    console.log(`💰 Payment request: ${amount} via ${method} (Table ${table})`);
  });

  // To'lov tasdiqlandi (Admin)
  socket.on("payment-approved", (data) => {
    const { orderId, table, clientId } = data;
    
    // Clientga yuborish
    const clientSocketId = rooms.clients.get(clientId);
    if (clientSocketId) {
      io.to(clientSocketId).emit("payment-approved", {
        orderId,
        approved: true,
        timestamp: Date.now()
      });
    }
    
    // Stol xonasiga ham yuborish
    io.to(`table-${table}`).emit("payment-approved", data);
    
    console.log(`✅ Payment approved for order ${orderId}`);
  });

  /* ========== CHEF MESSAGING ========== */
  
  // Chef xabari clientga
  socket.on("chef-message", (data) => {
    const { orderId, table, message, chefName } = data;
    
    io.to(`table-${table}`).emit("chef-message", {
      orderId,
      message,
      chefName: chefName || socket.chefName,
      timestamp: Date.now()
    });
    
    console.log(`💬 Message from ${socket.chefName} to table ${table}: ${message}`);
  });

  /* ========== TABLE MANAGEMENT ========== */
  
  // Stol yopildi (Admin)
  socket.on("table-force-closed", (data) => {
    const { table, reason } = data;
    
    // Stoldagi barcha clientlarga
    io.to(`table-${table}`).emit("table-force-closed", {
      table,
      reason: reason || "Admin tomonidan yopildi",
      timestamp: Date.now()
    });
    
    // Oshpazlarga ham xabar
    io.to('chefs').emit("table-closed", { table, reason });
    
    // Stolni tozalash
    rooms.tables.delete(table);
    
    console.log(`🔒 Table ${table} force closed`);
  });

  // Sessiya reset (Client)
  socket.on("session-reset", (data) => {
    const { clientId, table } = data;
    
    // Order ma'lumotlarini tozalash
    for (const [orderId, orderData] of rooms.orders.entries()) {
      if (orderData.clientId === clientId) {
        rooms.orders.delete(orderId);
      }
    }
    
    console.log(`🔄 Session reset for client ${clientId}`);
  });

  /* ========== MENU UPDATES ========== */
  
  // Menu yangilandi (Admin)
  socket.on("menu-updated", () => {
    io.emit("menu-updated", { timestamp: Date.now() });
    console.log("📋 Menu updated broadcasted");
  });

  /* ========== DISCONNECT ========== */
  socket.on("disconnect", () => {
    console.log("🔴 User disconnected:", socket.id);
    
    // Tozalash
    if (socket.role === 'client' && socket.clientId) {
      rooms.clients.delete(socket.clientId);
    }
    
    if (socket.role === 'chef' && socket.chefId) {
      rooms.chefs.delete(socket.chefId);
    }
    
    if (socket.table && rooms.tables.has(socket.table)) {
      rooms.tables.get(socket.table).delete(socket.id);
    }
  });
});

/* ================== HELPERS ================== */

function mapStatus(status) {
  const map = {
    'Yangi': 'new',
    'Tasdiqlandi': 'approved',
    'Tayyorlanmoqda': 'cooking',
    'Tayyor': 'ready',
    'Yetkazilmoqda': 'on_way',
    'Yetkazildi': 'delivered',
    'Topshirildi': 'delivered',
    'Yopildi': 'closed'
  };
  return map[status] || status.toLowerCase().replace(/\s+/g, '_');
}

function broadcastActiveOrders(chefId) {
  const activeOrders = [];
  for (const [orderId, data] of rooms.orders.entries()) {
    if (!data.chefId && (data.status === 'Yangi' || data.status === 'Tasdiqlandi')) {
      activeOrders.push({ orderId, ...data });
    }
  }
  
  if (activeOrders.length > 0) {
    const chefSocketId = rooms.chefs.get(chefId);
    if (chefSocketId) {
      io.to(chefSocketId).emit("active-orders", activeOrders);
    }
  }
}

/* ================== STATIC FILES ================== */
const STATIC_PATH = path.join(__dirname, "../admin-frontend/public");
app.use(express.static(STATIC_PATH));

/* ================== START ================== */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running: http://localhost:${PORT}`);
  console.log(`📡 Socket.IO ready for real-time connections`);
});