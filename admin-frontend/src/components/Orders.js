import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { socket } from '../socket';

export default function Orders(){
  const [orders, setOrders] = useState([]);

  async function load(){ setOrders(await api.getOrders()); }

  useEffect(()=> {
    load();
    socket.on('order:created', o => load());
    socket.on('order:updated', o => load());
    return ()=> { socket.off('order:created'); socket.off('order:updated'); };
  }, []);

  async function setStatus(id, status){
    await api.updateOrderStatus(id, status);
    load();
  }

  return (
    <div>
      <div className="card">
        <h3>Buyurtmalar</h3>
        <table className="table">
          <thead><tr><th>ID</th><th>Table</th><th>Items</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {orders.map(o=>(
              <tr key={o._id}>
                <td>{o._id.slice(-6)}</td>
                <td>{o.table}</td>
                <td>{(o.items||[]).map(i=>i.name+' x'+i.qty).join(', ')}</td>
                <td>{o.total}</td>
                <td>{o.status}</td>
                <td>
                  <button className="btn" onClick={()=>setStatus(o._id,'in_progress')}>Cooking</button>
                  <button className="btn primary" onClick={()=>setStatus(o._id,'ready')}>Ready</button>
                  <button className="btn" onClick={()=>setStatus(o._id,'delivered')}>Delivered</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
