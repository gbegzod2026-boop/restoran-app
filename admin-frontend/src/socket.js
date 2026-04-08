import { io } from "socket.io-client";
const SOCKET_URL = process.env.REACT_APP_SOCKET || 'http://localhost:4000';
export const socket = io(SOCKET_URL, { autoConnect: false });
io.on("connection", (socket) => {

    socket.on("client_join", table => {
        socket.join("table_" + table);
    });

    socket.on("chef_update_status", order => {
        io.to("table_" + order.table).emit("order_status_update", order);
    });

});
