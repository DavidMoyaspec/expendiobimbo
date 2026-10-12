(() => {
  "use strict";

  const STORAGE_KEY = "bimbostock-data-v1";
  const DAY = 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateFromToday = (offset) => {
    const date = new Date(today);
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };

  const initialLots = [
    { id: "lot-001", sku: "BIM-001", name: "Pan Blanco Grande", category: "Pan de caja", lot: "BB-101-A", receivedAt: dateFromToday(-5), expiresAt: dateFromToday(18), qty: 26, cost: 31.5, price: 44, emoji: "🍞" },
    { id: "lot-002", sku: "BIM-001", name: "Pan Blanco Grande", category: "Pan de caja", lot: "BB-094-B", receivedAt: dateFromToday(-12), expiresAt: dateFromToday(5), qty: 8, cost: 31.5, price: 44, emoji: "🍞" },
    { id: "lot-003", sku: "BIM-002", name: "Pan Integral", category: "Pan de caja", lot: "PI-209-C", receivedAt: dateFromToday(-3), expiresAt: dateFromToday(42), qty: 18, cost: 36, price: 52, emoji: "🌾" },
    { id: "lot-004", sku: "BIM-003", name: "Roles de Canela", category: "Pan dulce", lot: "RC-310-A", receivedAt: dateFromToday(-2), expiresAt: dateFromToday(4), qty: 14, cost: 22, price: 32, emoji: "🥐" },
    { id: "lot-005", sku: "BIM-004", name: "Mantecadas", category: "Pan dulce", lot: "MN-118-D", receivedAt: dateFromToday(-8), expiresAt: dateFromToday(-2), qty: 5, cost: 18, price: 27, emoji: "🧁" },
    { id: "lot-006", sku: "BIM-005", name: "Pan Tostado", category: "Pan de caja", lot: "PT-452-B", receivedAt: dateFromToday(-1), expiresAt: dateFromToday(65), qty: 21, cost: 26, price: 38, emoji: "🍞" },
    { id: "lot-007", sku: "BIM-006", name: "Donas Glaseadas", category: "Pan dulce", lot: "DG-077-A", receivedAt: dateFromToday(-3), expiresAt: dateFromToday(12), qty: 9, cost: 20, price: 29, emoji: "🍩" },
    { id: "lot-008", sku: "BIM-007", name: "Gansito", category: "Botanas", lot: "GA-620-C", receivedAt: dateFromToday(-2), expiresAt: dateFromToday(90), qty: 30, cost: 15, price: 22, emoji: "🍰" },
    { id: "lot-009", sku: "BIM-002", name: "Pan Integral", category: "Pan de caja", lot: "PI-190-A", receivedAt: dateFromToday(-18), expiresAt: dateFromToday(8), qty: 7, cost: 36, price: 52, emoji: "🌾" },
    { id: "lot-010", sku: "BIM-008", name: "Conchas surtidas", category: "Pan dulce", lot: "CS-204-B", receivedAt: dateFromToday(-4), expiresAt: dateFromToday(29), qty: 16, cost: 19, price: 28, emoji: "🥮" }
  ];
  const sampleSales = [
    { id: "V-1042", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 1.7).toISOString(), items: [{ name: "Pan Blanco Grande", qty: 2, price: 44 }, { name: "Roles de Canela", qty: 1, price: 32 }], total: 120, payment: "Efectivo" },
    { id: "V-1041", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4.5).toISOString(), items: [{ name: "Gansito", qty: 3, price: 22 }], total: 66, payment: "Tarjeta" }
  ];
  const loadState = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return { lots: initialLots, sales: sampleSales };
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed.lots) || !Array.isArray(parsed.sales)) throw new Error("El formato guardado no es válido.");
      return parsed;
    } catch (error) {
      console.error("No fue posible cargar los datos guardados:", error);
      return { lots: initialLots, sales: sampleSales };
    }
  };
  let state = loadState();
  let cart = {};
  let activeCategory = "Todos";
  let toastTimer;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const money = (amount) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(amount);
  const formatDate = (value) => new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const saveState = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("No fue posible guardar los datos:", error);
      showToast("No se pudieron guardar los cambios en este dispositivo.");
    }
  };
  const getDaysLeft = (expiry) => {
    const toUtcDay = (date) => {
      const [year, month, day] = date.split("-").map(Number);
      return Date.UTC(year, month - 1, day);
    };
    return Math.round((toUtcDay(expiry) - toUtcDay(dateFromToday(0))) / DAY);
  };
  const getStatus = (expiry) => {
    const days = getDaysLeft(expiry);
    if (days <= 7) return { key: "red", label: days < 0 ? "Caducado" : days === 0 ? "Caduca hoy" : `${days} días` };
    if (days <= 30) return { key: "yellow", label: `${days} días` };
    return { key: "green", label: "En buen estado" };
  };
  const availableStock = (sku) => state.lots.filter((lot) => lot.sku === sku && lot.qty > 0 && getDaysLeft(lot.expiresAt) >= 0).reduce((sum, lot) => sum + lot.qty, 0);
  const getProducts = () => {
    const products = new Map();
    state.lots.forEach((lot) => {
      if (!products.has(lot.sku)) products.set(lot.sku, { ...lot, qty: 0 });
      const product = products.get(lot.sku);
      product.qty += lot.qty;
      if (new Date(lot.receivedAt) > new Date(product.receivedAt)) Object.assign(product, { name: lot.name, category: lot.category, price: lot.price, emoji: lot.emoji });
    });
    return [...products.values()];
  };
  const showToast = (message) => {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 3200);
  };
  const navigate = (view) => {
    $$(".view-section").forEach((section) => section.classList.toggle("active", section.id === `view-${view}`));
    $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.viewLink === view));
    const labels = { dashboard: "Panel general", inventory: "Inventario", pos: "Punto de venta", sales: "Ventas" };
    $("#page-breadcrumb").textContent = labels[view];
    $("#sidebar").classList.remove("open");
    if (view === "pos") renderPOS();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const productMarkup = (product, extraClass = "") => `<span class="product-thumb c-${Math.abs([...product.sku].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 5}">${escapeHTML(product.emoji || "🍞")}</span>`;
  const renderDashboard = () => {
    const products = getProducts();
    const stockUnits = state.lots.reduce((sum, lot) => sum + lot.qty, 0);
    const inventoryValue = state.lots.reduce((sum, lot) => sum + lot.qty * lot.cost, 0);
    const dueLots = state.lots.filter((lot) => lot.qty > 0 && getDaysLeft(lot.expiresAt) <= 30);
    const todayString = dateFromToday(0);
    const todaysSales = state.sales.filter((sale) => sale.createdAt.slice(0, 10) === todayString);
    const salesTotal = todaysSales.reduce((sum, sale) => sum + sale.total, 0);
    $("#stat-inventory-value").textContent = money(inventoryValue);
    $("#stat-units").textContent = `${stockUnits} unidades en stock`;
    $("#stat-sales").textContent = money(salesTotal);
    $("#stat-orders").textContent = `${todaysSales.length} tickets registrados`;
    $("#stat-products").textContent = products.length;
    $("#stat-expiring").textContent = dueLots.length;
    $("#nav-expiring-count").textContent = dueLots.length;
    const weekSales = Array.from({ length: 7 }, (_, index) => {
      const day = dateFromToday(index - 6);
      return state.sales.filter((sale) => sale.createdAt.slice(0, 10) === day).reduce((sum, sale) => sum + sale.total, 0);
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
      return `<tr><td><div class="product-cell">${productMarkup(lot)}<span><strong>${escapeHTML(lot.name)}</strong><small>${escapeHTML(lot.sku)} · ${escapeHTML(lot.category)}</small></span></div></td><td><strong>${escapeHTML(lot.lot)}</strong></td><td>${formatDate(lot.receivedAt)}</td><td>${formatDate(lot.expiresAt)}</td><td><strong>${lot.qty}</strong> uds.</td><td><span class="status-pill status-${status.key}">${status.label}</span></td><td><button class="row-menu" data-delete-lot="${escapeHTML(lot.id)}" aria-label="Eliminar lote ${escapeHTML(lot.lot)}" title="Eliminar lote">···</button></td></tr>`;
    }).join("");
    $("#inventory-empty").classList.toggle("hidden", filtered.length > 0);
  };
  const renderPOS = () => {
    const query = $("#pos-search").value.trim().toLocaleLowerCase("es-MX");
    const products = getProducts().filter((product) => (activeCategory === "Todos" || product.category === activeCategory) && `${product.name} ${product.sku}`.toLocaleLowerCase("es-MX").includes(query));
    $("#pos-products").innerHTML = products.map((product) => {
      const available = availableStock(product.sku);
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
      return `<tr><td><strong>${escapeHTML(sale.id)}</strong></td><td>${new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(sale.createdAt))}</td><td>${itemCount} productos</td><td>${escapeHTML(sale.payment)}</td><td><strong>${money(sale.total)}</strong></td></tr>`;
    }).join("");
    $("#sales-history-count").textContent = `${sales.length} ${sales.length === 1 ? "ticket" : "tickets"}`;
    $("#sales-empty").classList.toggle("hidden", sales.length > 0);
  };
  const renderAll = () => {
    renderDashboard();
    renderInventory();
    renderPOS();
    renderSales();
  };
  const openLotModal = () => {
    const form = $("#lot-form");
    form.reset();
    form.elements.receivedAt.value = dateFromToday(0);
    form.elements.expiresAt.value = dateFromToday(30);
    $("#lot-form-error").classList.add("hidden");
    $("#lot-modal").classList.remove("hidden");
    form.elements.name.focus();
  };
  const closeLotModal = () => $("#lot-modal").classList.add("hidden");

  document.addEventListener("click", (event) => {
    const viewLink = event.target.closest("[data-view-link]");
    if (viewLink) { event.preventDefault(); navigate(viewLink.dataset.viewLink); }
    const addButton = event.target.closest("[data-add-product]");
    if (addButton) {
      const sku = addButton.dataset.addProduct;
      const nextQty = (cart[sku] || 0) + 1;
      if (nextQty > availableStock(sku)) return showToast("No hay suficiente stock disponible para esa cantidad.");
      cart[sku] = nextQty;
      renderCart();
    }
    const cartButton = event.target.closest("[data-cart-change]");
    if (cartButton) {
      const sku = cartButton.dataset.cartChange;
      const nextQty = (cart[sku] || 0) + Number(cartButton.dataset.delta);
      if (nextQty > availableStock(sku)) return showToast("No hay suficiente stock disponible.");
      if (nextQty <= 0) delete cart[sku]; else cart[sku] = nextQty;
      renderCart();
    }
    const deleteButton = event.target.closest("[data-delete-lot]");
    if (deleteButton) {
      const lot = state.lots.find((entry) => entry.id === deleteButton.dataset.deleteLot);
      if (!lot || !window.confirm(`¿Eliminar el lote ${lot.lot} de ${lot.name}?`)) return;
      state.lots = state.lots.filter((entry) => entry.id !== lot.id);
      saveState();
      renderAll();
      showToast("Lote eliminado del inventario.");
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
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeLotModal(); });
  $("#lot-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const error = $("#lot-form-error");
    const sku = String(data.get("sku")).trim().toLocaleUpperCase("es-MX");
    const lotName = String(data.get("lot")).trim().toLocaleUpperCase("es-MX");
    const qty = Number(data.get("qty"));
    const price = Number(data.get("price"));
    const cost = Number(data.get("cost"));
    if (data.get("expiresAt") < data.get("receivedAt")) {
      error.textContent = "La fecha de caducidad no puede ser anterior a la fecha de entrada.";
      error.classList.remove("hidden");
      return;
    }
    if (!Number.isInteger(qty) || qty < 1 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(cost) || cost < 0) {
      error.textContent = "Revisa las unidades, el precio de venta y el costo.";
      error.classList.remove("hidden");
      return;
    }
    if (state.lots.some((lot) => lot.lot.toLocaleUpperCase("es-MX") === lotName)) {
      error.textContent = "Ese número de lote ya está registrado.";
      error.classList.remove("hidden");
      return;
    }
    const emojis = { "Pan de caja": "🍞", "Pan dulce": "🥐", Botanas: "🍰", Otros: "📦" };
    state.lots.push({
      id: `lot-${Date.now()}`, sku, name: String(data.get("name")).trim(), category: String(data.get("category")),
      lot: lotName, receivedAt: String(data.get("receivedAt")), expiresAt: String(data.get("expiresAt")),
      qty, price, cost, emoji: emojis[String(data.get("category"))] || "📦"
    });
    saveState();
    closeLotModal();
    renderAll();
    showToast("Nuevo lote registrado correctamente.");
  });
  $("#checkout-button").addEventListener("click", () => {
    const entries = Object.entries(cart).filter(([, qty]) => qty > 0);
    if (!entries.length) return;
    for (const [sku, qty] of entries) {
      if (qty > availableStock(sku)) return showToast(`Stock insuficiente para ${sku}. Revisa el inventario.`);
    }
    const products = new Map(getProducts().map((product) => [product.sku, product]));
    const saleItems = [];
    for (const [sku, qty] of entries) {
      let remaining = qty;
      const lots = state.lots.filter((lot) => lot.sku === sku && lot.qty > 0 && getDaysLeft(lot.expiresAt) >= 0).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.expiresAt.localeCompare(b.expiresAt));
      for (const lot of lots) {
        if (remaining <= 0) break;
        const deducted = Math.min(remaining, lot.qty);
        lot.qty -= deducted;
        remaining -= deducted;
      }
      const product = products.get(sku);
      saleItems.push({ sku, name: product.name, qty, price: product.price });
    }
    const total = saleItems.reduce((sum, item) => sum + item.qty * item.price, 0);
    state.sales.push({ id: `V-${Date.now().toString().slice(-6)}`, createdAt: new Date().toISOString(), items: saleItems, total, payment: $("#payment-method").value });
    cart = {};
    saveState();
    renderAll();
    showToast(`Venta registrada por ${money(total)}. Se aplicó PEPS a los lotes disponibles.`);
  });
  $("#today-label").textContent = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short" }).format(new Date());
  $("#dashboard-date-label").textContent = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date()).toLocaleUpperCase("es-MX");

  renderAll();
})();
