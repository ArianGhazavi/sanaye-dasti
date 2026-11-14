
const loginForm = document.getElementById("loginForm");
const adminMain = document.getElementById("adminMain");
const message = document.getElementById("message");
const productsBox = document.getElementById("products");
const productForm = document.getElementById("productForm");

let editingId = null;

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "خطا");
  }

  return data;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

async function checkAdmin() {
  try {
    const data = await request("/api/me");

    if (data.user.role !== "admin") {
      throw new Error("شما مدیر نیستید");
    }

    loginForm.style.display = "none";
    adminMain.style.display = "block";
    message.textContent = "خوش آمدید مدیر";
    await loadProducts();
  } catch {
    adminMain.style.display = "none";
    loginForm.style.display = "block";
  }
}

loginForm.onsubmit = async e => {
  e.preventDefault();

  const form = new FormData(loginForm);

  try {
    const result = await request("/api/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form))
    });

    if (result.user.role !== "admin") {
      await request("/api/logout", { method: "POST" });
      throw new Error("این حساب مدیر نیست");
    }

    await checkAdmin();
  } catch (err) {
    message.textContent = err.message;
  }
};

document.getElementById("logout").onclick = async () => {
  await request("/api/logout", { method: "POST" });
  location.reload();
};

async function loadProducts() {
  const products = await request("/api/products");

  productsBox.innerHTML = products.map(p => `
    <div class="item">
      <b>${escapeHTML(p.name)}</b>
      <p>قیمت: ${escapeHTML(p.price)}</p>
      <p>موجودی: ${escapeHTML(p.stock)}</p>
      <button onclick="editProduct('${escapeHTML(p.id)}')">
        ویرایش
      </button>
      <button onclick="deleteProduct('${escapeHTML(p.id)}')">
        حذف
      </button>
    </div>
  `).join("");
}

productForm.onsubmit = async e => {
  e.preventDefault();

  const form = new FormData(productForm);
  const p = Object.fromEntries(form);

  p.price = Number(p.price || 0);
  p.stock = Number(p.stock || 0);
  p.active = productForm.active.checked;

  try {
    if (editingId) {
      await request("/api/products/" + encodeURIComponent(editingId), {
        method: "PUT",
        body: JSON.stringify(p)
      });
    } else {
      await request("/api/products", {
        method: "POST",
        body: JSON.stringify(p)
      });
    }

    editingId = null;
    productForm.reset();
    await loadProducts();
    message.textContent = "محصول ذخیره شد";
  } catch (err) {
    message.textContent = err.message;
  }
};

window.editProduct = async id => {
  const products = await request("/api/products");
  const p = products.find(x => x.id === id);
  if (!p) return;

  editingId = id;

  for (const key of ["name", "category", "price", "stock", "description", "image"]) {
    productForm.elements[key].value = p[key] ?? "";
  }

  productForm.elements.active.checked = !!p.active;
};

window.deleteProduct = async id => {
  if (!confirm("محصول حذف شود؟")) return;

  await request("/api/products/" + encodeURIComponent(id), {
    method: "DELETE"
  });

  await loadProducts();
};

checkAdmin();
