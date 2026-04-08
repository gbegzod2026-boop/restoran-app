import React from 'react';

export default function Layout({children, view, setView}) {
  return (
    <div>
      <header className="header">
        <div className="brand">
          <img src="/logo.png" alt="foodify" />
          <div>
            <h2 style={{margin:0}}>Foodify Admin</h2>
            <div className="small">Restaurant control panel</div>
          </div>
        </div>

        <div className="controls">
          <button className={`btn ${view==='dashboard'?'primary':''}`} onClick={()=>setView('dashboard')}>Dashboard</button>
          <button className={`btn ${view==='categories'?'primary':''}`} onClick={()=>setView('categories')}>Kategoriyalar</button>
          <button className={`btn ${view==='foods'?'primary':''}`} onClick={()=>setView('foods')}>Taomlar</button>
          <button className={`btn ${view==='orders'?'primary':''}`} onClick={()=>setView('orders')}>Buyurtmalar</button>
        </div>
      </header>

      <main className="container">
        {children}
      </main>
    </div>
  );
}
