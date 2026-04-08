import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { socket } from '../socket';

export default function Categories(){
  const [cats, setCats] = useState([]);
  const [name, setName] = useState('');

  async function load() {
    const c = await api.getCategories();
    setCats(c);
  }

  useEffect(()=> {
    load();
    // optionally socket events if emitted on category create
  }, []);

  async function add(){
    if(!name) return alert('Nomi kiriting');
    await api.createCategory({ name });
    setName('');
    load();
  }

  return (
    <div>
      <div className="card">
        <h3>Kategoriya qo‘shish</h3>
        <div className="form-row">
          <input placeholder="Kategoriya nomi" value={name} onChange={e=>setName(e.target.value)} />
          <button className="btn primary" onClick={add}>Qo‘shish</button>
        </div>
      </div>

      <div className="card">
        <h3>Kategoriyalar</h3>
        <ul>
          {cats.map(c=> <li key={c._id}>{c.name}</li>)}
        </ul>
      </div>
    </div>
  );
}
