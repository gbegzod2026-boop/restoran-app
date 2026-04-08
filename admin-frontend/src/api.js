const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:4000/api';

export async function fetchJSON(path, opts) {
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) throw new Error('API error ' + res.status);
  return res.json();
}

export const api = {
  getCategories: () => fetchJSON('/categories'),
  createCategory: (data) => fetchJSON('/categories', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(data)}),
  getFoods: () => fetchJSON('/foods'),
  createFood: (data) => fetchJSON('/foods', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(data)}),
  getOrders: () => fetchJSON('/orders'),
  createOrder: (data) => fetchJSON('/orders', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(data)}),
  updateOrderStatus: (id,status) => fetchJSON(`/orders/${id}/status`, { method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify({status})}),
  getStaff: () => fetchJSON('/staff'),
  createStaff: (d) => fetchJSON('/staff', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(d)})
};
