document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();
    const errorMsg = document.getElementById("errorMsg");

    const res = await fetch("http://localhost:3000/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!data.success) {
        errorMsg.textContent = data.message;
        return;
    }

    // foydalanuvchi maʼlumotlarini saqlaymiz
    localStorage.setItem("user", JSON.stringify(data.user));

    // rolga qarab yo‘naltiramiz
    if (data.user.role === "admin") {
        window.location.href = "admin.html";
    } else if (data.user.role === "kassir") {
        window.location.href = "kassa.html";
    } else if (data.user.role === "oshpaz") {
        window.location.href = "oshpaz.html";
    } else {
        window.location.href = "client.html";
    }
});
