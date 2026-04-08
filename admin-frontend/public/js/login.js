console.log("LOGIN JS YUKLANDI");

import { t, applyLang, getLang, setLang } from "./i18n.js";

document.addEventListener("DOMContentLoaded", () => {
  applyLang();
});

const langSelect = document.getElementById("langSelect");
const authFields = document.getElementById("authFields");
const loginBtn = document.getElementById("loginBtn");
const clientBtn = document.getElementById("clientBtn");
const roleSelect = document.getElementById("role");
const error = document.getElementById("error");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const togglePassword = document.getElementById("togglePassword");

if (langSelect) {
  langSelect.value = getLang();
  langSelect.addEventListener("change", e => {
    setLang(e.target.value);
  });
}

if (clientBtn) clientBtn.style.display = "none";

/* ROLE CHANGE */
roleSelect?.addEventListener("change", () => {
  if (roleSelect.value === "client") {
    authFields.style.display = "none";
    loginBtn.style.display = "none";
    clientBtn.style.display = "block";
  } else {
    authFields.style.display = "block";
    loginBtn.style.display = "block";
    clientBtn.style.display = "none";
  }
});

/* LOGIN */
loginBtn?.addEventListener("click", () => {
  const username = usernameInput?.value.trim();
  const password = passwordInput?.value.trim();
  const role = roleSelect?.value;

  if (error) error.textContent = "";

  if (!username || !password || !role) {
    if (error) error.textContent = t("login_error");
    return;
  }

  const users = {
    admin: { password: "1234", role: "admin", id: "admin" },
    chef: { password: "1234", role: "chef", id: "chef" },
    waiter: { password: "1234", role: "waiter", id: "waiter" }
  };

  const user = users[username];

  if (!user || user.password !== password) {
    if (error) error.textContent = t("login_error");
    return;
  }

  if (user.role !== role) {
    if (error) error.textContent = t("login_error");
    return;
  }

  localStorage.setItem("role", role);
  localStorage.setItem("name", username);

  // ID larni ham saqlaymiz
  localStorage.setItem("userId", user.id);
  localStorage.setItem("uid", user.id);

  if (role === "chef") {
    localStorage.setItem("chefId", user.id);
  } else {
    localStorage.removeItem("chefId");
  }

  location.href = role + ".html";
});

/* CLIENT */
clientBtn?.addEventListener("click", () => {
  localStorage.setItem("role", "client");
  localStorage.setItem("name", "client");
  localStorage.removeItem("chefId");
  localStorage.removeItem("userId");
  localStorage.removeItem("uid");
  location.href = "client.html";
});

/* TOGGLE PASSWORD */
if (togglePassword && passwordInput) {
  togglePassword.addEventListener("click", () => {
    const isHidden = passwordInput.type === "password";
    passwordInput.type = isHidden ? "text" : "password";
    togglePassword.textContent = isHidden ? "🙈" : "👁️";
  });
}