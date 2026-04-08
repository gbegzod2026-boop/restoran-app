/* =========================
   i18n.js
========================= */
console.log("🌐 i18n.js yuklandi");

let currentLang = localStorage.getItem("lang") || "uz";
const listeners = [];

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  currentLang = lang;
  localStorage.setItem("lang", lang);
  applyLang();
  listeners.forEach(cb => cb(lang));
}

export function t(key) {
  const lang = getLang();
  const dict = window.LANGS?.[lang] || {};

  if (Object.prototype.hasOwnProperty.call(dict, key)) {
    return dict[key];
  }

  const nested = key.split(".").reduce((obj, part) => obj?.[part], dict);

  return nested ?? key;
}

export function applyLang() {
  document.querySelectorAll("[data-i18n-alt]").forEach(el => {
    const key = el.dataset.i18nAlt;
    if (!key) return;
    el.setAttribute("alt", t(key));
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    el.placeholder = t(key);
  });

  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    el.innerText = t(key);
  });

}

export function onLangChange(cb) {
  listeners.push(cb);
}
window.t = t;