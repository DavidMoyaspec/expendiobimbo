(() => {
  "use strict";

  const DAY = 24 * 60 * 60 * 1000;
  const API_URL = String(window.BIMBOSTOCK_API_URL || "").replace(/\/+$/, "");
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const money = (amount) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(amount);
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  let currentUser = null;
  let csrfToken = "";
  let state = { lots: [], sales: [], products: [] };
  let cart = {};
  let activeCategory = "Todos";
  let toastTimer;

  const dateFromToday = (offset) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const formatDate = (value) => new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
  const localDateKey = (value) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const getDaysLeft = (expiry) => {
    const [year, month, day] = expiry.split("-").map(Number);
    const [todayYear, todayMonth, todayDay] = dateFromToday(0).split("-").map(Number);
    return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(todayYear, todayMonth - 1, todayDay)) / DAY);
  };
  const getStatus = (expiry) => {
    const days = getDaysLeft(expiry);
    if (days <= 7) return { key: "red", label: days < 0 ? "Caducado" : days === 0 ? "Caduca hoy" : `${days} días` };
    if (days <= 30) return { key: "yellow", label: `${days} días` };
    return { key: "green", label: "En buen estado" };
  };
  const getProducts = () => state.products;
  const showToast = (message) => {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 3600);
  };
  const setFormError = (selector, message) => {
    const error = $(selector);
    error.textContent = message;
    error.classList.toggle("hidden", !message);
  };

  const apiRequest = async (path, options = {}) => {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (csrfToken && ["POST", "PATCH", "DELETE", "PUT"].includes(options.method)) headers["X-CSRF-Token"] = csrfToken;
    let response;
    try {
      response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });
    } catch (_error) {
      throw new Error("No fue posible conectar con el servidor. Revisa la URL del API y tu conexión.");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && currentUser && path !== "/api/session") showLogin("Tu sesión venció. Inicia sesión nuevamente.");
      throw new Error(payload.error || `El servidor respondió con el error ${response.status}.`);
    }
    return payload;
  };
  const refreshState = async () => {
    state = await apiRequest("/api/state");
    renderAll();
  };
  const setAuthenticated = (user) => {
    currentUser = user;
    $("#auth-screen").classList.add("hidden");
    $("#app-shell").classList.remove("hidden");
    $("#user-name").textContent = user.username;
    $("#user-role").textContent = user.role === "admin" ? "Administrador" : "Cajero";
    const initials = user.username.slice(0, 2).toLocaleUpperCase("es-MX");
    $("#user-avatar").textContent = initials;
    $("#top-avatar").textContent = initials;
    $("#welcome-name").textContent = user.username;
    $$("[data-role='admin']").forEach((element) => element.classList.toggle("hidden", user.role !== "admin"));
    if (user.role !== "admin") navigate("pos");
  };
  const showLogin = (message = "") => {
    currentUser = null;
    csrfToken = "";
    cart = {};
    state = { lots: [], sales: [], products: [] };
    $("#app-shell").classList.add("hidden");
    $("#auth-screen").classList.remove("hidden");
    setFormError("#login-error", message);
    $("#login-form").reset();
  };
  const bootstrap = async () => {
    $("#today-label").textContent = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short" }).format(new Date());
    $("#dashboard-date-label").textContent = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date()).toLocaleUpperCase("es-MX");
    try {
      const response = await apiRequest("/api/session");
      csrfToken = response.csrf_token;
      setAuthenticated(response.user);
      await refreshState();
    } catch (error) {
      if (error.message.includes("Inicia sesión")) {
        showLogin();
      } else {
        showLogin(error.message);
      }
    }
  };

  const navigate = (view) => {
    if (currentUser?.role !== "admin" && view !== "pos") return;
    const section = $(`#view-${view}`);
    if (!section) return;
    $$(".view-section").forEach((item) => item.classList.toggle("active", item === section));
    $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.viewLink === view));
    const labels = { dashboard: "Panel general", inventory: "Inventario", pos: "Punto de venta", sales: "Ventas" };
    $("#page-breadcrumb").textContent = labels[view];
    $("#sidebar").classList.remove("open");
    if (view === "pos") renderPOS();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const productMarkup = (product) => `<span class="product-thumb c-${Math.abs([...product.sku].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 5}">${escapeHTML(product.emoji || "📦")}</span>`;

  const renderDashboard = () => {
    const stockUnits = state.lots.reduce((sum, lot) => sum + lot.qty, 0);
    const inventoryValue = state.lots.reduce((sum, lot) => sum + lot.qty * lot.cost, 0);
    const dueLots = state.lots.filter((lot) => lot.qty > 0 && getDaysLeft(lot.expiresAt) <= 30);
    const todayString = dateFromToday(0);
    const todaysSales = state.sales.filter((sale) => localDateKey(sale.createdAt) === todayString);
    const salesTotal = todaysSales.reduce((sum, sale) => sum + sale.total, 0);
    $("#stat-inventory-value").textContent = money(inventoryValue);
    $("#stat-units").textContent = `${stockUnits} unidades en stock`;
    $("#stat-sales").textContent = money(salesTotal);
    $("#stat-orders").textContent = `${todaysSales.length} tickets registrados`;
    $("#stat-products").textContent = state.products.length;
    $("#stat-expiring").textContent = dueLots.length;
    $("#nav-expiring-count").textContent = dueLots.length;
    const weekSales = Array.from({ length: 7 }, (_, index) => {
      const day = dateFromToday(index - 6);
      return state.sales.filter((sale) => localDateKey(sale.createdAt) === day).reduce((sum, sale) => sum + sale.total, 0);
    });
    $("#week-sales").textContent = money(weekSales.reduce((sum, total) => sum + total, 0));
    renderChart(weekSales);
    const counts = { green: 0, yellow: 0, red: 0 };
    state.lots.filter((lot) => lot.qty > 0).forEach((lot) => counts[getStatus(lot.expiresAt).key]++);
    const totalLots = counts.green + counts.yellow + counts.red;
    $("#expiry-lots-total").textContent = totalLots;
    $("#expiry-green").textContent = counts.green;
    $("#expiry-yellow").textContent = counts.yellow;
    $("#expiry-red").textContent = counts.red;
    const greenPercent = totalLots ? counts.green / totalLots * 100 : 0;
    const yellowPercent = totalLots ? counts.yellow / totalLots * 100 : 0;
    $("#expiry-donut").style.background = totalLots
      ? `conic-gradient(#36aa7c 0 ${greenPercent}%, #edbe4a ${greenPercent}% ${greenPercent + yellowPercent}%, #e97575 ${greenPercent + yellowPercent}% 100%)`
      : "#edf0f3";
    const expiring = state.lots.filter((lot) => lot.qty > 0 && getDaysLeft(lot.expiresAt) <= 30).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)).slice(0, 4);
    $("#dashboard-expiring-rows").innerHTML = expiring.map((lot) => {
      const status = getStatus(lot.expiresAt);
      return `<tr><td><div class="product-cell">${productMarkup(lot)}<span><strong>${escapeHTML(lot.name)}</strong><small>Lote ${escapeHTML(lot.lot)}</small></span></div></td><td>${lot.qty} uds.</td><td>${status.label}</td><td><span class="status-pill status-${status.key}">${status.key === "red" ? "Crítico" : status.key === "yellow" ? "Próximo" : "En buen estado"}</span></td></tr>`;
    }).join("");
    $("#dashboard-expiring-empty").classList.toggle("hidden", expiring.length > 0);
  };
  const renderChart = (values) => {
    const width = 700;
    const height = 180;
    const max = Math.max(...values, 100);
    const points = values.map((value, index) => `${index * width / Math.max(values.length - 1, 1)},${height - (value / max * (height - 24)) - 8}`);
    const line = `M ${points.join(" L ")}`;
    $("#chart-line").setAttribute("d", line);
    $("#chart-fill").setAttribute("d", `${line} L ${width},${height} L 0,${height} Z`);
    $("#chart-labels").innerHTML = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat("es-MX", { weekday: "short" }).format(new Date(`${dateFromToday(index - 6)}T12:00:00`)).replace(".", "")).map((day) => `<span>${day}</span>`).join("");
  };
  const renderInventory = () => {
    const query = $("#inventory-search").value.trim().toLocaleLowerCase("es-MX");
    const sortedLots = [...state.lots].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
    const filtered = sortedLots.filter((lot) => `${lot.name} ${lot.sku} ${lot.lot}`.toLocaleLowerCase("es-MX").includes(query));
    const units = state.lots.reduce((sum, lot) => sum + lot.qty, 0);
    const expiring = state.lots.filter((lot) => lot.qty > 0 && getDaysLeft(lot.expiresAt) <= 30).length;
    $("#inventory-summary").innerHTML = `<div class="inventory-summary-card"><span>Unidades en inventario</span><strong>${units}<em>unidades</em></strong></div><div class="inventory-summary-card"><span>Lotes registrados</span><strong>${state.lots.length}<em>lotes</em></strong></div><div class="inventory-summary-card"><span>Atención requerida</span><strong>${expiring}<em>por caducar</em></strong></div>`;
    $("#inventory-rows").innerHTML = filtered.map((lot) => {
      const status = getStatus(lot.expiresAt);
      return `<tr><td><div class="product-cell">${productMarkup(lot)}<span><strong>${escapeHTML(lot.name)}</strong><small>${escapeHTML(lot.sku)} · ${escapeHTML(lot.category)}</small></span></div></td><td><strong>${escapeHTML(lot.lot)}</strong></td><td>${formatDate(lot.receivedAt)}</td><td>${formatDate(lot.expiresAt)}</td><td><strong>${lot.qty}</strong> uds.</td><td>${money(lot.price)}</td><td><span class="status-pill status-${status.key}">${status.label}</span></td><td><button class="row-menu" data-delete-lot="${lot.id}" aria-label="Eliminar lote ${escapeHTML(lot.lot)}" title="Eliminar lote">···</button></td></tr>`;
    }).join("");
    $("#inventory-empty").classList.toggle("hidden", filtered.length > 0);
  };
  const renderPOS = () => {
    const query = $("#pos-search").value.trim().toLocaleLowerCase("es-MX");
    const products = getProducts().filter((product) => (activeCategory === "Todos" || product.category === activeCategory) && `${product.name} ${product.sku}`.toLocaleLowerCase("es-MX").includes(query));
    $("#pos-products").innerHTML = products.map((product) => {
      const available = product.stock;
      return `<button class="pos-product" data-add-product="${escapeHTML(product.sku)}" ${available <= 0 ? "disabled" : ""}>${productMarkup(product)}<strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(product.sku)}</small><span class="pos-stock ${available <= 0 ? "out" : ""}">${available <= 0 ? "Sin stock" : `${available} disponibles`}</span><span class="pos-price">${money(product.price)}</span></button>`;
    }).join("");
    $("#pos-empty").classList.toggle("hidden", products.length > 0);
    $("#cart-date").textContent = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
    renderCart();
  };
  const renderCart = () => {
    const entries = Object.entries(cart).filter(([, qty]) => qty > 0);
    const products = new Map(getProducts().map((product) => [product.sku, product]));
    const count = entries.reduce((sum, [, qty]) => sum + qty, 0);
    const total = entries.reduce((sum, [sku, qty]) => sum + (products.get(sku)?.price || 0) * qty, 0);
    $("#cart-count").textContent = count;
    $("#cart-empty").classList.toggle("hidden", entries.length > 0);
    $("#cart-items").innerHTML = entries.map(([sku, qty]) => {
      const product = products.get(sku);
      if (!product) return "";
      return `<div class="cart-item">${productMarkup(product)}<span class="cart-item-info"><strong>${escapeHTML(product.name)}</strong><small>${money(product.price)} c/u</small></span><span class="quantity-control"><button data-cart-change="${escapeHTML(sku)}" data-delta="-1" aria-label="Quitar uno">−</button>${qty}<button data-cart-change="${escapeHTML(sku)}" data-delta="1" aria-label="Agregar uno">+</button></span></div>`;
    }).join("");
    $("#cart-subtotal").textContent = money(total);
    $("#cart-total").textContent = money(total);
    $("#checkout-total").textContent = money(total);
    $("#checkout-button").disabled = count === 0;
  };
  const renderSales = () => {
    const sales = [...state.sales].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    $("#sales-rows").innerHTML = sales.map((sale) => {
      const itemCount = sale.items.reduce((sum, item) => sum + item.qty, 0);
      return `<tr><td><strong>${escapeHTML(sale.id)}</strong></td><td>${new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(sale.createdAt))}</td><td>${escapeHTML(sale.cashier)}</td><td>${itemCount} productos</td><td>${escapeHTML(sale.payment)}</td><td><strong>${money(sale.total)}</strong></td></tr>`;
    }).join("");
    $("#sales-history-count").textContent = `${sales.length} ${sales.length === 1 ? "ticket" : "tickets"}`;
    $("#sales-empty").classList.toggle("hidden", sales.length > 0);
  };
  const renderAll = () => {
    if (currentUser?.role === "admin") {
      renderDashboard();
      renderInventory();
      renderSales();
    }
    renderPOS();
  };

  const openLotModal = () => {
    const form = $("#lot-form");
    form.reset();
    form.elements.receivedAt.value = dateFromToday(0);
    form.elements.expiresAt.value = dateFromToday(30);
    setFormError("#lot-form-error", "");
    $("#lot-modal").classList.remove("hidden");
    form.elements.name.focus();
  };
  const closeLotModal = () => $("#lot-modal").classList.add("hidden");
  const openProductModal = () => {
    const products = getProducts();
    if (!products.length) return showToast("Registra primero un lote para crear el catálogo.");
    $("#product-select").innerHTML = products.map((product) => `<option value="${escapeHTML(product.sku)}">${escapeHTML(product.name)} (${escapeHTML(product.sku)})</option>`).join("");
    setProductForm(products[0]);
    setFormError("#product-form-error", "");
    $("#product-modal").classList.remove("hidden");
  };
  const setProductForm = (product) => {
    $("#product-name").value = product.name;
    $("#product-category").value = product.category;
    $("#product-price").value = product.price;
  };

  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#login-button");
    button.disabled = true;
    setFormError("#login-error", "");
    const values = new FormData(event.currentTarget);
    try {
      const response = await apiRequest("/api/login", {
        method: "POST",
        body: JSON.stringify({ username: values.get("username"), password: values.get("password") })
      });
      csrfToken = response.csrf_token;
      setAuthenticated(response.user);
      await refreshState();
    } catch (error) {
      setFormError("#login-error", error.message);
    } finally {
      button.disabled = false;
    }
  });
  $("#logout-button").addEventListener("click", async () => {
    try {
      await apiRequest("/api/logout", { method: "POST", body: "{}" });
      showLogin();
    } catch (error) {
      showToast(error.message);
    }
  });

  document.addEventListener("click", async (event) => {
    const viewLink = event.target.closest("[data-view-link]");
    if (viewLink) {
      event.preventDefault();
      navigate(viewLink.dataset.viewLink);
    }
    const addButton = event.target.closest("[data-add-product]");
    if (addButton) {
      const product = state.products.find((item) => item.sku === addButton.dataset.addProduct);
      if (!product) return;
      const nextQty = (cart[product.sku] || 0) + 1;
      if (nextQty > product.stock) return showToast("No hay suficiente stock disponible para esa cantidad.");
      cart[product.sku] = nextQty;
      renderCart();
    }
    const cartButton = event.target.closest("[data-cart-change]");
    if (cartButton) {
      const sku = cartButton.dataset.cartChange;
      const product = state.products.find((item) => item.sku === sku);
      const nextQty = (cart[sku] || 0) + Number(cartButton.dataset.delta);
      if (nextQty > (product?.stock || 0)) return showToast("No hay suficiente stock disponible.");
      if (nextQty <= 0) delete cart[sku]; else cart[sku] = nextQty;
      renderCart();
    }
    const deleteButton = event.target.closest("[data-delete-lot]");
    if (deleteButton && currentUser?.role === "admin") {
      const lot = state.lots.find((entry) => entry.id === Number(deleteButton.dataset.deleteLot));
      if (!lot || !window.confirm(`¿Eliminar el lote ${lot.lot} de ${lot.name}?`)) return;
      try {
        await apiRequest(`/api/lots/${lot.id}`, { method: "DELETE" });
        await refreshState();
        showToast("Lote eliminado del inventario.");
      } catch (error) {
        showToast(error.message);
      }
    }
  });

  $("#menu-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#inventory-search").addEventListener("input", renderInventory);
  $("#pos-search").addEventListener("input", renderPOS);
  $$(".category-tab").forEach((tab) => tab.addEventListener("click", () => {
    activeCategory = tab.dataset.category;
    $$(".category-tab").forEach((item) => item.classList.toggle("active", item === tab));
    renderPOS();
  }));
  $("#open-lot-modal").addEventListener("click", openLotModal);
  $("#close-lot-modal").addEventListener("click", closeLotModal);
  $("#cancel-lot-modal").addEventListener("click", closeLotModal);
  $("#lot-modal").addEventListener("click", (event) => { if (event.target === $("#lot-modal")) closeLotModal(); });
  $("#open-product-modal").addEventListener("click", openProductModal);
  $("#close-product-modal").addEventListener("click", () => $("#product-modal").classList.add("hidden"));
  $("#cancel-product-modal").addEventListener("click", () => $("#product-modal").classList.add("hidden"));
  $("#product-modal").addEventListener("click", (event) => { if (event.target === $("#product-modal")) $("#product-modal").classList.add("hidden"); });
  $("#product-select").addEventListener("change", (event) => {
    const product = state.products.find((item) => item.sku === event.target.value);
    if (product) setProductForm(product);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeLotModal();
      $("#product-modal").classList.add("hidden");
    }
  });
  $("#lot-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const lot = {
      name: String(data.get("name")).trim(),
      sku: String(data.get("sku")).trim().toLocaleUpperCase("es-MX"),
      category: String(data.get("category")),
      lot: String(data.get("lot")).trim().toLocaleUpperCase("es-MX"),
      qty: Number(data.get("qty")),
      receivedAt: String(data.get("receivedAt")),
      expiresAt: String(data.get("expiresAt")),
      price: Number(data.get("price")),
      cost: Number(data.get("cost"))
    };
    if (lot.expiresAt < lot.receivedAt) return setFormError("#lot-form-error", "La fecha de caducidad no puede ser anterior a la fecha de entrada.");
    if (!Number.isInteger(lot.qty) || lot.qty < 1 || !Number.isFinite(lot.price) || lot.price <= 0 || !Number.isFinite(lot.cost) || lot.cost < 0) {
      return setFormError("#lot-form-error", "Revisa las unidades, el precio de venta y el costo.");
    }
    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      await apiRequest("/api/lots", { method: "POST", body: JSON.stringify(lot) });
      closeLotModal();
      await refreshState();
      showToast("Nuevo lote registrado correctamente.");
    } catch (error) {
      setFormError("#lot-form-error", error.message);
    } finally {
      submit.disabled = false;
    }
  });
  $("#product-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const sku = String(data.get("sku"));
    const button = $("#save-product-button");
    button.disabled = true;
    setFormError("#product-form-error", "");
    try {
      await apiRequest(`/api/products/${encodeURIComponent(sku)}`, {
        method: "PATCH",
        body: JSON.stringify({ name: data.get("name"), category: data.get("category"), price: Number(data.get("price")) })
      });
      $("#product-modal").classList.add("hidden");
      await refreshState();
      showToast("Producto y precio actualizados.");
    } catch (error) {
      setFormError("#product-form-error", error.message);
    } finally {
      button.disabled = false;
    }
  });
  $("#checkout-button").addEventListener("click", async () => {
    const items = Object.entries(cart).filter(([, qty]) => qty > 0).map(([sku, qty]) => ({ sku, qty }));
    if (!items.length) return;
    const button = $("#checkout-button");
    button.disabled = true;
    try {
      const sale = await apiRequest("/api/sales", {
        method: "POST",
        body: JSON.stringify({ items, payment: $("#payment-method").value })
      });
      cart = {};
      await refreshState();
      showToast(`Venta registrada por ${money(sale.total)}. Se aplicó PEPS a los lotes disponibles.`);
    } catch (error) {
      showToast(error.message);
      await refreshState().catch((refreshError) => showToast(refreshError.message));
    } finally {
      button.disabled = false;
      renderCart();
    }
  });

  bootstrap();
})();
