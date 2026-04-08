import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { socket } from '../socket';

export default function Dashboard(){
  const [stats, setStats] = useState({ orders:0, income:0, staffActive:0});
  const [orders, setOrders] = useState([]);

  async function load() {
    const all = await api.getOrders();
    setOrders(all);
    setStats({
      orders: all.length,
      income: all.reduce((s,o)=>s + (o.total||0),0),
      staffActive: 0 // fetch staff if needed
    });
  }

  useEffect(()=> {
    load();
    socket.on('order:created', o => { load(); });
    socket.on('order:updated', o => { load(); });
    return () => {
      socket.off('order:created'); socket.off('order:updated');
    };
  }, []);

  return (
    <div>
      <div className="grid">
        <div className="card"><h3>Bugungi buyurtmalar</h3><h2>{stats.orders}</h2></div>
        <div className="card"><h3>Bugungi tushum</h3><h2>{stats.income} so'm</h2></div>
        <div className="card"><h3>Faol xodimlar</h3><h2>{stats.staffActive}</h2></div>
      </div>

      <div className="card">
        <h3>So‘nggi buyurtmalar</h3>
        <table className="table">
          <thead><tr><th>ID</th><th>Table</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>
            {orders.slice(0,10).map(o=>(
              <tr key={o._id}>
                <td>{o._id.slice(-6)}</td>
                <td>{o.table}</td>
                <td>{(o.items||[]).map(i=>i.name+' x'+i.qty).join(', ')}</td>
                <td>{o.total}</td>
                <td>{o.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
