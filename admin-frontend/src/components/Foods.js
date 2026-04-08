import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { socket } from '../socket';

export default function Foods(){
  const [foods, setFoods] = useState([]);
  const [cats, setCats] = useState([]);
  const [form, setForm] = useState({ name:'', category:'', price:0, image:'' });

  async function load(){
    const f = await api.getFoods();
    const c = await api.getCategories();
    setFoods(f);
    setCats(c);
  }

  useEffect(()=> {
    load();
    socket.on('food:created', (f) => load());
    return () => socket.off('food:created');
  }, []);

  async function add(e){
    e.preventDefault();
    if(!form.name || !form.category) return alert('to‘ldiring');
    await api.createFood({ name:form.name, category:form.category, price:Number(form.price), image:form.image, available:true });
    setForm({ name:'', category:'', price:0, image:'' });
    load();
  }

  return (
    <div>
      <div className="card">
        <h3>Yangi taom qo‘shish</h3>
        <form onSubmit={add}>
          <div className="form-row">
            <input placeholder="Nom" value={form.name} onChange={e=>setForm({...form, name:e.target.value})} />
            <select value={form.category} onChange={e=>setForm({...form, category:e.target.value})}>
              <option value="">— tanlang —</option>
              {cats.map(c=> <option value={c._id} key={c._id}>{c.name}</option>)}
            </select>
            <input type="number" placeholder="Narx" value={form.price} onChange={e=>setForm({...form, price:e.target.value})} />
          </div>
          <div className="form-row">
            <input placeholder="Rasm URL (ixtiyoriy)" value={form.image} onChange={e=>setForm({...form, image:e.target.value})} />
            <button className="btn primary" type="submit">Qo‘shish</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3>Taomlar</h3>
        <div className="grid">
          {foods.map(f=>(
            <div key={f._id} className="card">
              <h4>{f.name}</h4>
              <div className="small">{f.category?.name}</div>
              <div><b>{f.price} so'm</b></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
