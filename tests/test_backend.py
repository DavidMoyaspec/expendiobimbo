import secrets
import tempfile
import unittest
from pathlib import Path

from backend import create_app
from werkzeug.security import check_password_hash, generate_password_hash


class BackendTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database = str(Path(self.temp_dir.name) / "test.sqlite3")
        self.app = create_app(
            {
                "TESTING": True,
                "SECRET_KEY": secrets.token_hex(32),
                "DATABASE": self.database,
                "SESSION_COOKIE_SECURE": False,
                "SESSION_COOKIE_SAMESITE": "Lax",
                "ALLOWED_ORIGINS": ["http://localhost:5000"],
                "PASSWORD_HASH_METHOD": "pbkdf2:sha256:10000",
            }
        )
        self.client = self.app.test_client()
        self.admin_password = secrets.token_urlsafe(24)
        self.cashier_password = secrets.token_urlsafe(24)
        with self.app.app_context():
            from backend import get_db

            database = get_db()
            database.execute(
                "INSERT INTO users(username, password_hash, role) VALUES (?, ?, ?)",
                ("Marystell", generate_password_hash(self.admin_password, method=self.app.config["PASSWORD_HASH_METHOD"]), "admin"),
            )
            database.execute(
                "INSERT INTO users(username, password_hash, role) VALUES (?, ?, ?)",
                ("Carlos", generate_password_hash(self.cashier_password, method=self.app.config["PASSWORD_HASH_METHOD"]), "cashier"),
            )
            database.execute(
                "INSERT INTO products(sku, name, category, price_cents) VALUES (?, ?, ?, ?)",
                ("BIM-001", "Pan Blanco", "Pan de caja", 4400),
            )
            database.execute(
                "INSERT INTO lots(sku, lot, received_at, expires_at, qty, cost_cents) VALUES (?, ?, ?, ?, ?, ?)",
                ("BIM-001", "OLD", "2026-01-01", "2099-01-01", 2, 3150),
            )
            database.execute(
                "INSERT INTO lots(sku, lot, received_at, expires_at, qty, cost_cents) VALUES (?, ?, ?, ?, ?, ?)",
                ("BIM-001", "NEW", "2026-01-02", "2099-01-01", 3, 3200),
            )
            database.commit()

    def tearDown(self):
        self.temp_dir.cleanup()

    def login(self, username="Carlos", password=None):
        if password is None:
            password = self.cashier_password
        response = self.client.post(
            "/api/login",
            json={"username": username, "password": password},
            headers={"Origin": "http://localhost:5000"},
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        return response.get_json()["csrf_token"]

    def test_cashier_is_limited_to_catalog_and_sales(self):
        self.login()
        state = self.client.get("/api/state").get_json()
        self.assertEqual(state["lots"], [])
        self.assertEqual(state["sales"], [])
        self.assertEqual(state["products"][0]["stock"], 5)
        self.assertNotIn("cost", state["products"][0])
        denied = self.client.post(
            "/api/lots",
            json={"name": "No autorizado"},
            headers={"X-CSRF-Token": "irrelevant", "Origin": "http://localhost:5000"},
        )
        self.assertEqual(denied.status_code, 403)

    def test_frontend_and_config_are_served_by_flask(self):
        page = self.client.get("/")
        self.assertEqual(page.status_code, 200)
        self.assertIn(b'id="login-form"', page.data)
        page.close()
        config = self.client.get("/config.js")
        self.assertEqual(config.status_code, 200)
        self.assertIn(b"BIMBOSTOCK_API_URL", config.data)
        config.close()

    def test_sale_uses_server_price_and_fifo_and_rejects_overselling_atomically(self):
        token = self.login()
        sold = self.client.post(
            "/api/sales",
            json={"items": [{"sku": "BIM-001", "qty": 4, "price": 0.01}], "payment": "Efectivo"},
            headers={"X-CSRF-Token": token, "Origin": "http://localhost:5000"},
        )
        self.assertEqual(sold.status_code, 201, sold.get_json())
        self.assertEqual(sold.get_json()["total"], 176.0)
        self.client.post("/api/logout", json={}, headers={"X-CSRF-Token": token})
        admin_token = self.login("Marystell", self.admin_password)
        state = self.client.get("/api/state").get_json()
        self.assertEqual([(lot["lot"], lot["qty"]) for lot in state["lots"]], [("OLD", 0), ("NEW", 1)])
        self.assertEqual(state["sales"][0]["total"], 176.0)

        oversold = self.client.post(
            "/api/sales",
            json={"items": [{"sku": "BIM-001", "qty": 2}], "payment": "Tarjeta"},
            headers={"X-CSRF-Token": admin_token, "Origin": "http://localhost:5000"},
        )
        self.assertEqual(oversold.status_code, 409)
        after_failure = self.client.get("/api/state").get_json()
        self.assertEqual([(lot["lot"], lot["qty"]) for lot in after_failure["lots"]], [("OLD", 0), ("NEW", 1)])
        self.assertEqual(len(after_failure["sales"]), 1)

    def test_admin_can_manage_products_and_cashier_cannot(self):
        cashier_token = self.login()
        update = self.client.patch(
            "/api/products/BIM-001",
            json={"name": "Pan especial", "category": "Pan de caja", "price": 50.25},
            headers={"X-CSRF-Token": cashier_token, "Origin": "http://localhost:5000"},
        )
        self.assertEqual(update.status_code, 403)
        delete = self.client.delete(
            "/api/lots/1",
            headers={"X-CSRF-Token": cashier_token, "Origin": "http://localhost:5000"},
        )
        self.assertEqual(delete.status_code, 403)

        self.client.post("/api/logout", json={}, headers={"X-CSRF-Token": cashier_token})
        admin_token = self.login("Marystell", self.admin_password)
        update = self.client.patch(
            "/api/products/BIM-001",
            json={"name": "Pan especial", "category": "Pan de caja", "price": 50.25},
            headers={"X-CSRF-Token": admin_token, "Origin": "http://localhost:5000"},
        )
        self.assertEqual(update.status_code, 200, update.get_json())
        self.assertEqual(self.client.get("/api/state").get_json()["products"][0]["price"], 50.25)
        delete = self.client.delete(
            "/api/lots/1",
            headers={"X-CSRF-Token": admin_token, "Origin": "http://localhost:5000"},
        )
        self.assertEqual(delete.status_code, 200, delete.get_json())

    def test_mutations_require_csrf_and_untrusted_origins_are_rejected(self):
        token = self.login()
        response = self.client.post(
            "/api/sales",
            json={"items": [{"sku": "BIM-001", "qty": 1}], "payment": "Efectivo"},
            headers={"Origin": "http://localhost:5000"},
        )
        self.assertEqual(response.status_code, 403)
        invalid_sale = self.client.post(
            "/api/sales",
            json={"items": [{"sku": "BIM-001", "qty": 0}], "payment": "Efectivo"},
            headers={"X-CSRF-Token": token, "Origin": "http://localhost:5000"},
        )
        self.assertEqual(invalid_sale.status_code, 400)
        invalid_payment = self.client.post(
            "/api/sales",
            json={"items": [{"sku": "BIM-001", "qty": 1}], "payment": []},
            headers={"X-CSRF-Token": token, "Origin": "http://localhost:5000"},
        )
        self.assertEqual(invalid_payment.status_code, 400)
        response = self.client.get("/api/state", headers={"Origin": "https://untrusted.example"})
        self.assertEqual(response.status_code, 403)

    def test_login_failures_are_limited_and_session_cookie_is_http_only(self):
        for _ in range(8):
            response = self.client.post(
                "/api/login",
                json={"username": "Carlos", "password": "incorrect"},
                headers={"Origin": "http://localhost:5000"},
            )
            self.assertEqual(response.status_code, 401)
        blocked = self.client.post(
            "/api/login",
            json={"username": "Carlos", "password": self.cashier_password},
            headers={"Origin": "http://localhost:5000"},
        )
        self.assertEqual(blocked.status_code, 429)
        self.client = self.app.test_client()
        self.client.environ_base["REMOTE_ADDR"] = "127.0.0.2"
        response = self.client.post(
            "/api/login",
            json={"username": "Carlos", "password": self.cashier_password},
            headers={"Origin": "http://localhost:5000"},
        )
        self.assertEqual(response.status_code, 200)
        cookie_header = response.headers["Set-Cookie"]
        self.assertIn("HttpOnly", cookie_header)
        self.assertIn("Expires=", cookie_header)

    def test_initial_user_wizard_prompts_and_stores_only_password_hashes(self):
        database = str(Path(self.temp_dir.name) / "bootstrap.sqlite3")
        app = create_app(
            {
                "TESTING": True,
                "SECRET_KEY": secrets.token_hex(32),
                "DATABASE": database,
                "PASSWORD_HASH_METHOD": "pbkdf2:sha256:10000",
                "ALLOWED_ORIGINS": [],
            }
        )
        passwords = {username: secrets.token_urlsafe(24) for username, _role in (
            ("Marystell", "admin"),
            ("Carlos", "cashier"),
            ("Alondra", "cashier"),
            ("Maribel", "cashier"),
        )}
        answers = "\n".join(password for value in passwords.values() for password in (value, value)) + "\n"
        result = app.test_cli_runner().invoke(args=["init-users"], input=answers)
        self.assertEqual(result.exit_code, 0, f"{result.output} {result.exception!r}")
        with app.app_context():
            from backend import get_db

            users = get_db().execute("SELECT username, password_hash, role FROM users ORDER BY username").fetchall()
        self.assertEqual(len(users), 4)
        for row in users:
            self.assertNotEqual(row["password_hash"], passwords[row["username"]])
            self.assertTrue(check_password_hash(row["password_hash"], passwords[row["username"]]))


if __name__ == "__main__":
    unittest.main()
