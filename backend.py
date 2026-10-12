import os
import re
import secrets
import sqlite3
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

import click
from flask import Flask, abort, current_app, g, jsonify, request, send_from_directory, session
from flask.cli import with_appcontext
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash


ROOT = Path(__file__).resolve().parent
ACCOUNTS = (("Marystell", "admin"), ("Carlos", "cashier"), ("Alondra", "cashier"), ("Maribel", "cashier"))
CATEGORIES = {"Pan de caja", "Pan dulce", "Botanas", "Otros"}
PAYMENT_METHODS = {"Efectivo", "Tarjeta", "Transferencia"}
SKU_PATTERN = re.compile(r"^[A-Z0-9._-]{1,20}$")
PASSWORD_HASH_METHOD = "pbkdf2:sha256:600000"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'cashier'))
);
CREATE TABLE IF NOT EXISTS products (
    sku TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents > 0)
);
CREATE TABLE IF NOT EXISTS lots (
    id INTEGER PRIMARY KEY,
    sku TEXT NOT NULL REFERENCES products(sku),
    lot TEXT NOT NULL UNIQUE,
    received_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    qty INTEGER NOT NULL CHECK (qty >= 0),
    cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0)
);
CREATE INDEX IF NOT EXISTS lots_fifo ON lots(sku, received_at, expires_at, id);
CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    payment TEXT NOT NULL,
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    cashier TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id),
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    qty INTEGER NOT NULL CHECK (qty > 0),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0)
);
CREATE INDEX IF NOT EXISTS sales_recent ON sales(created_at);
CREATE TABLE IF NOT EXISTS login_attempts (
    address TEXT PRIMARY KEY,
    window_started TEXT NOT NULL,
    failures INTEGER NOT NULL
);
"""


def create_app(test_config=None):
    app = Flask(__name__, static_folder=None)
    cookie_secure = os.environ.get("BIMBOSTOCK_COOKIE_SECURE", "1")
    if cookie_secure not in {"0", "1"}:
        raise RuntimeError("BIMBOSTOCK_COOKIE_SECURE debe ser 0 o 1.")
    cookie_secure = cookie_secure == "1"
    app.config.update(
        SECRET_KEY=os.environ.get("BIMBOSTOCK_SECRET_KEY"),
        DATABASE=os.environ.get("BIMBOSTOCK_DATABASE", str(ROOT / "instance" / "bimbostock.sqlite3")),
        SESSION_COOKIE_NAME="bimbostock_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=cookie_secure,
        SESSION_COOKIE_SAMESITE="None" if cookie_secure else "Lax",
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
        PASSWORD_HASH_METHOD=PASSWORD_HASH_METHOD,
        TRUSTED_PROXY_COUNT=int(os.environ.get("BIMBOSTOCK_TRUSTED_PROXY_COUNT", "0")),
        ALLOWED_ORIGINS=[
            origin.strip().rstrip("/")
            for origin in os.environ.get(
                "BIMBOSTOCK_ALLOWED_ORIGINS", "http://localhost:5000,http://127.0.0.1:5000"
            ).split(",")
            if origin.strip()
        ],
        MAX_CONTENT_LENGTH=64 * 1024,
    )
    if test_config:
        app.config.update(test_config)
    if not app.config.get("SECRET_KEY"):
        raise RuntimeError("Define BIMBOSTOCK_SECRET_KEY antes de iniciar BimboStock.")
    if not 0 <= app.config["TRUSTED_PROXY_COUNT"] <= 5:
        raise RuntimeError("BIMBOSTOCK_TRUSTED_PROXY_COUNT debe estar entre 0 y 5.")
    if app.config["TRUSTED_PROXY_COUNT"]:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=app.config["TRUSTED_PROXY_COUNT"], x_proto=app.config["TRUSTED_PROXY_COUNT"])
    app.config["DUMMY_PASSWORD_HASH"] = generate_password_hash(secrets.token_urlsafe(32), method=PASSWORD_HASH_METHOD)

    with app.app_context():
        init_db()

    @app.teardown_appcontext
    def close_database(_error=None):
        connection = g.pop("database", None)
        if connection is not None:
            connection.close()

    @app.before_request
    def enforce_origin_and_preflight():
        if not request.path.startswith("/api/"):
            return None
        origin = request.headers.get("Origin")
        if origin and origin.rstrip("/") not in current_app.config["ALLOWED_ORIGINS"]:
            return api_error("Origen no permitido.", 403)
        if request.method == "OPTIONS":
            return current_app.make_response(("", 204))
        if request.method in {"POST", "PATCH", "PUT"} and not request.is_json:
            return api_error("Se requiere contenido JSON.", 415)
        return None

    @app.after_request
    def security_headers(response):
        origin = request.headers.get("Origin")
        if origin and origin.rstrip("/") in current_app.config["ALLOWED_ORIGINS"]:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Vary"] = "Origin"
            if request.method == "OPTIONS":
                response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
                response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-CSRF-Token"
                response.headers["Access-Control-Max-Age"] = "600"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if current_app.config["SESSION_COOKIE_SECURE"]:
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.errorhandler(413)
    def too_large(_error):
        return api_error("La solicitud es demasiado grande.", 413)

    @app.errorhandler(HTTPException)
    def http_error(error):
        if request.path.startswith("/api/"):
            return api_error(error.description, error.code or 500)
        return error

    @app.errorhandler(Exception)
    def unexpected_error(error):
        current_app.logger.exception("Unhandled request error")
        if request.path.startswith("/api/"):
            return api_error("Ocurrió un error interno. Inténtalo de nuevo.", 500)
        return "Ocurrió un error interno.", 500

    @app.get("/")
    def index():
        return send_from_directory(ROOT, "index.html")

    @app.get("/<path:filename>")
    def frontend_file(filename):
        if filename.startswith("api/"):
            abort(404)
        return send_from_directory(ROOT, filename)

    @app.get("/api/session")
    def current_session():
        user = authenticated_user()
        if not user:
            return api_error("Inicia sesión para continuar.", 401)
        return jsonify({"user": public_user(user), "csrf_token": csrf_token()})

    @app.post("/api/login")
    def login():
        data = json_body()
        username = data.get("username", "")
        password = data.get("password", "")
        if not isinstance(username, str) or not isinstance(password, str) or len(username) > 80 or len(password) > 1024:
            return api_error("Usuario o contraseña incorrectos.", 401)

        address = request.remote_addr or "unknown"
        connection = get_db()
        now = datetime.now(timezone.utc)
        row = connection.execute("SELECT * FROM login_attempts WHERE address = ?", (address,)).fetchone()
        if row and datetime.fromisoformat(row["window_started"]) > now - timedelta(minutes=15) and row["failures"] >= 8:
            return api_error("Demasiados intentos. Espera 15 minutos y vuelve a intentarlo.", 429)

        user = connection.execute(
            "SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username.strip(),)
        ).fetchone()
        stored_hash = user["password_hash"] if user else current_app.config["DUMMY_PASSWORD_HASH"]
        password_matches = check_password_hash(stored_hash, password)
        valid = bool(user) and password_matches
        if not valid:
            if row and datetime.fromisoformat(row["window_started"]) > now - timedelta(minutes=15):
                connection.execute(
                    "UPDATE login_attempts SET failures = failures + 1 WHERE address = ?", (address,)
                )
            else:
                connection.execute(
                    "INSERT OR REPLACE INTO login_attempts(address, window_started, failures) VALUES (?, ?, 1)",
                    (address, now.isoformat()),
                )
            connection.commit()
            return api_error("Usuario o contraseña incorrectos.", 401)

        connection.execute("DELETE FROM login_attempts WHERE address = ?", (address,))
        connection.commit()
        session.clear()
        session.permanent = True
        session["user_id"] = user["id"]
        session["csrf_token"] = secrets.token_urlsafe(32)
        return jsonify({"user": public_user(user), "csrf_token": session["csrf_token"]})

    @app.post("/api/logout")
    def logout():
        user = require_user()
        if not require_csrf():
            return api_error("La sesión no es válida. Recarga e inténtalo de nuevo.", 403)
        session.clear()
        return jsonify({"ok": True, "user": public_user(user)})

    @app.get("/api/state")
    def state():
        user = require_user()
        products = get_products()
        lots = []
        sales = []
        if user["role"] == "admin":
            lots = get_lots()
            sales = get_sales()
        return jsonify({"user": public_user(user), "products": products, "lots": lots, "sales": sales})

    @app.post("/api/lots")
    def create_lot():
        if not require_role("admin"):
            return api_error("Solo el administrador puede modificar el inventario.", 403)
        if not require_csrf():
            return api_error("La sesión no es válida. Recarga e inténtalo de nuevo.", 403)
        data = json_body()
        try:
            name = text_value(data, "name", 60)
            sku = text_value(data, "sku", 20).upper()
            category = text_value(data, "category", 30)
            lot_code = text_value(data, "lot", 24).upper()
            received_at = parse_date(data, "receivedAt")
            expires_at = parse_date(data, "expiresAt")
            qty = integer_value(data, "qty", 1, 1_000_000)
            price_cents = money_cents(data.get("price"), allow_zero=False)
            cost_cents = money_cents(data.get("cost"), allow_zero=True)
            if not SKU_PATTERN.fullmatch(sku):
                raise ValueError("El SKU solo puede contener letras, números, puntos, guiones y guiones bajos.")
            if category not in CATEGORIES:
                raise ValueError("La categoría no es válida.")
            if received_at > expires_at:
                raise ValueError("La caducidad no puede ser anterior a la entrada.")
        except ValueError as error:
            return api_error(str(error), 400)

        connection = get_db()
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """INSERT INTO products(sku, name, category, price_cents) VALUES (?, ?, ?, ?)
                   ON CONFLICT(sku) DO UPDATE SET name = excluded.name,
                   category = excluded.category, price_cents = excluded.price_cents""",
                (sku, name, category, price_cents),
            )
            cursor = connection.execute(
                "INSERT INTO lots(sku, lot, received_at, expires_at, qty, cost_cents) VALUES (?, ?, ?, ?, ?, ?)",
                (sku, lot_code, received_at, expires_at, qty, cost_cents),
            )
            connection.commit()
        except sqlite3.IntegrityError:
            connection.rollback()
            return api_error("El SKU o el número de lote ya está registrado, o los datos no son válidos.", 409)
        except Exception:
            connection.rollback()
            raise
        return jsonify({"lot_id": cursor.lastrowid}), 201

    @app.delete("/api/lots/<int:lot_id>")
    def delete_lot(lot_id):
        if not require_role("admin"):
            return api_error("Solo el administrador puede modificar el inventario.", 403)
        if not require_csrf():
            return api_error("La sesión no es válida. Recarga e inténtalo de nuevo.", 403)
        cursor = get_db().execute("DELETE FROM lots WHERE id = ?", (lot_id,))
        get_db().commit()
        if cursor.rowcount == 0:
            return api_error("No se encontró ese lote.", 404)
        return jsonify({"ok": True})

    @app.patch("/api/products/<sku>")
    def update_product(sku):
        if not require_role("admin"):
            return api_error("Solo el administrador puede modificar productos y precios.", 403)
        if not require_csrf():
            return api_error("La sesión no es válida. Recarga e inténtalo de nuevo.", 403)
        data = json_body()
        try:
            name = text_value(data, "name", 60)
            category = text_value(data, "category", 30)
            price_cents = money_cents(data.get("price"), allow_zero=False)
            normalized_sku = sku.upper()
            if category not in CATEGORIES:
                raise ValueError("La categoría no es válida.")
            if not SKU_PATTERN.fullmatch(normalized_sku):
                raise ValueError("El SKU no es válido.")
        except ValueError as error:
            return api_error(str(error), 400)
        cursor = get_db().execute(
            "UPDATE products SET name = ?, category = ?, price_cents = ? WHERE sku = ?",
            (name, category, price_cents, normalized_sku),
        )
        get_db().commit()
        if cursor.rowcount == 0:
            return api_error("No se encontró ese producto.", 404)
        return jsonify({"ok": True})

    @app.post("/api/sales")
    def create_sale():
        user = require_user()
        if not user:
            return api_error("Inicia sesión para continuar.", 401)
        if not require_csrf():
            return api_error("La sesión no es válida. Recarga e inténtalo de nuevo.", 403)
        data = json_body()
        payment = data.get("payment")
        items = data.get("items")
        if not isinstance(payment, str) or payment not in PAYMENT_METHODS or not isinstance(items, list) or not items or len(items) > 100:
            return api_error("El ticket o el método de pago no son válidos.", 400)

        requested = {}
        for item in items:
            if not isinstance(item, dict):
                return api_error("Los productos del ticket no son válidos.", 400)
            sku = item.get("sku")
            qty = item.get("qty")
            if not isinstance(sku, str) or not SKU_PATTERN.fullmatch(sku.upper()):
                return api_error("El SKU de un producto no es válido.", 400)
            try:
                quantity = integer_value({"qty": qty}, "qty", 1, 1_000_000)
            except ValueError as error:
                return api_error(str(error), 400)
            key = sku.upper()
            requested[key] = requested.get(key, 0) + quantity
            if requested[key] > 1_000_000:
                return api_error("La cantidad solicitada es demasiado grande.", 400)

        connection = get_db()
        try:
            connection.execute("BEGIN IMMEDIATE")
            current_date = date.today().isoformat()
            prepared = []
            for sku, qty in requested.items():
                product = connection.execute("SELECT * FROM products WHERE sku = ?", (sku,)).fetchone()
                if not product:
                    raise ValueError(f"El producto {sku} ya no está disponible.")
                lots = connection.execute(
                    """SELECT * FROM lots WHERE sku = ? AND qty > 0 AND expires_at >= ?
                       ORDER BY received_at ASC, expires_at ASC, id ASC""",
                    (sku, current_date),
                ).fetchall()
                available = sum(lot["qty"] for lot in lots)
                if available < qty:
                    raise ValueError(f"Stock insuficiente para {product['name']}. Disponible: {available}.")
                prepared.append((product, lots, qty))

            now = datetime.now(timezone.utc).isoformat()
            sale_id = f"V-{now[:10].replace('-', '')}-{secrets.token_hex(8).upper()}"
            total_cents = sum(product["price_cents"] * qty for product, _, qty in prepared)
            connection.execute(
                "INSERT INTO sales(id, created_at, payment, total_cents, cashier) VALUES (?, ?, ?, ?, ?)",
                (sale_id, now, payment, total_cents, user["username"]),
            )
            sale_items = []
            for product, lots, qty in prepared:
                remaining = qty
                for lot in lots:
                    deducted = min(remaining, lot["qty"])
                    connection.execute("UPDATE lots SET qty = qty - ? WHERE id = ?", (deducted, lot["id"]))
                    remaining -= deducted
                    if not remaining:
                        break
                connection.execute(
                    "INSERT INTO sale_items(sale_id, sku, name, qty, unit_price_cents) VALUES (?, ?, ?, ?, ?)",
                    (sale_id, product["sku"], product["name"], qty, product["price_cents"]),
                )
                sale_items.append(
                    {"sku": product["sku"], "name": product["name"], "qty": qty, "price": cents_to_money(product["price_cents"])}
                )
            connection.commit()
        except ValueError as error:
            connection.rollback()
            return api_error(str(error), 409)
        except Exception:
            connection.rollback()
            raise
        return jsonify(
            {
                "id": sale_id,
                "createdAt": now,
                "payment": payment,
                "total": cents_to_money(total_cents),
                "items": sale_items,
            }
        ), 201

    app.cli.add_command(init_db_command)
    app.cli.add_command(init_users_command)
    return app


def get_db():
    if "database" not in g:
        g.database = sqlite3.connect(current_app.config["DATABASE"], timeout=10)
        g.database.row_factory = sqlite3.Row
        g.database.execute("PRAGMA foreign_keys = ON")
    return g.database


def init_db():
    path = Path(current_app.config["DATABASE"])
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    try:
        connection.executescript(SCHEMA)
    finally:
        connection.close()
    path.chmod(0o600)


def api_error(message, status):
    return jsonify({"error": message}), status


def json_body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def authenticated_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def require_user():
    user = authenticated_user()
    if not user:
        abort(401, description="Inicia sesión para continuar.")
    return user


def require_role(role):
    user = authenticated_user()
    if not user:
        abort(401, description="Inicia sesión para continuar.")
    return user["role"] == role


def require_csrf():
    expected = session.get("csrf_token")
    supplied = request.headers.get("X-CSRF-Token", "")
    return bool(expected and secrets.compare_digest(expected, supplied))


def csrf_token():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    return session["csrf_token"]


def public_user(user):
    return {"username": user["username"], "role": user["role"]}


def cents_to_money(cents):
    return cents / 100


def money_cents(value, allow_zero):
    if isinstance(value, bool) or value is None:
        raise ValueError("El precio o costo no es válido.")
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError("El precio o costo no es válido.")
    if not amount.is_finite() or amount < 0 or (not allow_zero and amount == 0) or amount > Decimal("99999999"):
        raise ValueError("El precio o costo está fuera del rango permitido.")
    cents = amount * 100
    if cents != cents.to_integral_value():
        raise ValueError("Los precios deben tener máximo dos decimales.")
    return int(cents)


def text_value(data, key, maximum):
    value = data.get(key)
    if not isinstance(value, str):
        raise ValueError(f"El campo {key} es obligatorio.")
    value = value.strip()
    if not value or len(value) > maximum:
        raise ValueError(f"El campo {key} debe tener entre 1 y {maximum} caracteres.")
    return value


def parse_date(data, key):
    value = text_value(data, key, 10)
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"La fecha {key} no es válida.")
    if parsed.isoformat() != value:
        raise ValueError(f"La fecha {key} debe usar el formato AAAA-MM-DD.")
    return value


def integer_value(data, key, minimum, maximum):
    value = data.get(key)
    if isinstance(value, bool):
        raise ValueError("La cantidad debe ser un número entero válido.")
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValueError("La cantidad debe ser un número entero válido.")
    if str(value).strip() != str(number) or not minimum <= number <= maximum:
        raise ValueError(f"La cantidad debe estar entre {minimum} y {maximum}.")
    return number


def get_products():
    today = date.today().isoformat()
    rows = get_db().execute(
        """SELECT p.sku, p.name, p.category, p.price_cents,
                  COALESCE(SUM(CASE WHEN l.qty > 0 AND l.expires_at >= ? THEN l.qty ELSE 0 END), 0) AS stock
           FROM products p LEFT JOIN lots l ON l.sku = p.sku
           GROUP BY p.sku ORDER BY p.name COLLATE NOCASE""",
        (today,),
    ).fetchall()
    return [
        {
            "sku": row["sku"],
            "name": row["name"],
            "category": row["category"],
            "price": cents_to_money(row["price_cents"]),
            "stock": row["stock"],
            "emoji": {"Pan de caja": "🍞", "Pan dulce": "🥐", "Botanas": "🍰", "Otros": "📦"}.get(row["category"], "📦"),
        }
        for row in rows
    ]


def get_lots():
    rows = get_db().execute(
        """SELECT l.id, l.sku, p.name, p.category, p.price_cents, l.lot, l.received_at,
                  l.expires_at, l.qty, l.cost_cents
           FROM lots l JOIN products p ON p.sku = l.sku ORDER BY l.expires_at, l.received_at"""
    ).fetchall()
    return [
        {
            "id": row["id"],
            "sku": row["sku"],
            "name": row["name"],
            "category": row["category"],
            "price": cents_to_money(row["price_cents"]),
            "lot": row["lot"],
            "receivedAt": row["received_at"],
            "expiresAt": row["expires_at"],
            "qty": row["qty"],
            "cost": cents_to_money(row["cost_cents"]),
            "emoji": {"Pan de caja": "🍞", "Pan dulce": "🥐", "Botanas": "🍰", "Otros": "📦"}.get(row["category"], "📦"),
        }
        for row in rows
    ]


def get_sales():
    rows = get_db().execute(
        "SELECT id, created_at, payment, total_cents, cashier FROM sales ORDER BY created_at DESC"
    ).fetchall()
    sales = []
    for row in rows:
        items = get_db().execute(
            "SELECT sku, name, qty, unit_price_cents FROM sale_items WHERE sale_id = ? ORDER BY id",
            (row["id"],),
        ).fetchall()
        sales.append(
            {
                "id": row["id"],
                "createdAt": row["created_at"],
                "payment": row["payment"],
                "total": cents_to_money(row["total_cents"]),
                "cashier": row["cashier"],
                "items": [
                    {"sku": item["sku"], "name": item["name"], "qty": item["qty"], "price": cents_to_money(item["unit_price_cents"])}
                    for item in items
                ],
            }
        )
    return sales


@click.command("init-db")
@with_appcontext
def init_db_command():
    init_db()
    click.echo("Base de datos inicializada.")


@click.command("init-users")
@with_appcontext
def init_users_command():
    connection = get_db()
    for username, role in ACCOUNTS:
        exists = connection.execute(
            "SELECT 1 FROM users WHERE username = ? COLLATE NOCASE", (username,)
        ).fetchone()
        if exists:
            click.echo(f"{username}: ya existe; se conserva su contraseña.")
            continue
        while True:
            password = click.prompt(f"Contraseña nueva para {username}", hide_input=True, confirmation_prompt=True)
            if not 12 <= len(password) <= 1024:
                click.echo("Usa entre 12 y 1024 caracteres.")
                continue
            break
        connection.execute(
            "INSERT INTO users(username, password_hash, role) VALUES (?, ?, ?)",
            (username, generate_password_hash(password, method=current_app.config["PASSWORD_HASH_METHOD"]), role),
        )
        connection.commit()
        click.echo(f"Cuenta {username} creada.")
    click.echo("Configuración de usuarios completa.")


if __name__ == "__main__":
    create_app().run()
