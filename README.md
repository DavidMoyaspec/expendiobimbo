# BimboStock — Inventario y punto de venta

Aplicación web de inventario por lotes y punto de venta. La interfaz conserva el diseño existente, pero los datos y las operaciones ahora se guardan en SQLite y se autorizan en el backend Flask. No hay inventario, ventas, credenciales ni sesiones guardadas en `localStorage`.

## Roles y controles

- **Marystell — administradora:** puede consultar el resumen y las ventas, registrar y retirar lotes, cambiar los datos de productos y precios. Crear un lote de un SKU existente también actualiza los datos del producto y su precio.
- **Carlos, Alondra y Maribel — cajeros:** pueden consultar el catálogo y registrar ventas. No reciben los datos internos de lotes, costos ni ventas, y el servidor rechaza sus intentos de modificar catálogo, precios o inventario.
- Cada venta se valida en el servidor y se guarda junto con el descuento de lotes dentro de una transacción SQLite. El servidor calcula el total con el precio vigente, ignora precios enviados por el navegador, excluye lotes caducados y aplica PEPS por fecha de entrada, caducidad e identificador. Si no hay stock suficiente, no registra el ticket ni descuenta parcialmente.
- Las contraseñas se solicitan interactivamente en la configuración inicial, exigen al menos 12 caracteres y se persisten únicamente como hashes PBKDF2-SHA256. Las sesiones están firmadas, usan cookies `HttpOnly`, expiran tras ocho horas y requieren token CSRF para cambios. Los intentos fallidos se limitan por dirección IP.

## Requisitos e instalación local

Requiere Python 3.10 o posterior. En PowerShell desde la carpeta del repositorio:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:BIMBOSTOCK_SECRET_KEY = (.\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(48))")
$env:BIMBOSTOCK_COOKIE_SECURE = "0"
```

Guarda la clave generada en un gestor seguro si se usará fuera del entorno local. No la escribas en archivos del repositorio ni la compartas. La aplicación no arranca si no está definida. El valor `0` de cookie segura es solo para HTTP local; el backend activa `Secure` por defecto y en producción debe ejecutarse detrás de HTTPS.

La base de datos se inicializa en `instance/bimbostock.sqlite3` al iniciar Flask. Crea las cuentas iniciales ejecutando:

```powershell
.\.venv\Scripts\flask.exe --app backend init-users
```

El comando pregunta una contraseña nueva dos veces para cada cuenta que aún no exista y no imprime ni guarda la contraseña. Las cuentas ya creadas se omiten; para cambiar una contraseña, utiliza un procedimiento administrativo fuera del repositorio, no borres hashes a mano ni pongas contraseñas en comandos o archivos de configuración.

Arranca el servidor de desarrollo local:

```powershell
.\.venv\Scripts\flask.exe --app backend run --host 127.0.0.1 --port 5000
```

Abre <http://127.0.0.1:5000>. En local, la cookie no requiere HTTPS; el servidor utiliza como orígenes permitidos `http://localhost:5000` y `http://127.0.0.1:5000`. Para ejecutar las pruebas automatizadas:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

## Conectar el frontend

`config.js` define `window.BIMBOSTOCK_API_URL`. Déjalo vacío cuando Flask sirva también los archivos web desde la misma URL. Si el frontend se aloja por separado, cambia ese valor por la URL pública **HTTPS** del backend, sin barra final, por ejemplo:

```js
window.BIMBOSTOCK_API_URL = "https://api.ejemplo.com";
```

La URL del API no es secreta. El backend debe incluir el origen exacto del sitio web en `BIMBOSTOCK_ALLOWED_ORIGINS`, separado por comas si hay más de uno. Para un sitio `https://usuario.github.io`, configura ese origen exacto (no la URL de la página con su ruta). El backend establece cookies `Secure` y `SameSite=None` cuando `BIMBOSTOCK_COOKIE_SECURE=1`; configura además `BIMBOSTOCK_SECRET_KEY` como secreto de entorno en el proveedor.

## Publicar sin dejar encendida tu computadora

La aplicación que corre en `localhost` solo es accesible desde tu PC. Para que siga disponible cuando la apagues, publica el backend en un alojamiento. **GitHub Pages solo publica archivos estáticos: no ejecuta Flask ni almacena la base de datos.** La opción de menor configuración es alojar frontend y backend juntos en una cuenta de PythonAnywhere, si el plan gratuito está disponible para tu cuenta. No es un contenedor Docker, sino una aplicación Flask atendida por el servidor WSGI del proveedor. Los planes gratuitos tienen límites de uso y no ofrecen las mismas garantías de disponibilidad, recursos o soporte que un servicio pagado; consulta las condiciones vigentes antes de operar.

### PythonAnywhere

1. Publica en GitHub la versión del repositorio que quieras desplegar. En PythonAnywhere crea una cuenta y una aplicación web con configuración manual; su guía oficial de Flask explica la pestaña **Web**, los entornos virtuales y el archivo WSGI: <https://help.pythonanywhere.com/pages/Flask/>. En la consola Bash del proveedor clona el repositorio (`git clone <URL-DEL-REPOSITORIO>`). Si el repositorio es privado, usa un método de acceso autorizado de GitHub configurado en el proveedor; nunca pegues un token en el comando ni lo añadas a los archivos del proyecto.
2. En la consola Bash crea un entorno virtual con una versión de Python que esté disponible en PythonAnywhere (por ejemplo, `mkvirtualenv --python=/usr/bin/python3.13 bimbostock`; ajusta la versión según la lista del proveedor), activa el entorno con `workon bimbostock` e instala las dependencias desde la carpeta clonada: `pip install -r requirements.txt`. En la pestaña **Web**, selecciona configuración manual y elige esa misma versión de Python. Configura el entorno virtual con la ruta que muestra `which python`.
3. Crea un directorio privado y persistente para la base y un archivo privado para la clave de sesión, fuera del repositorio. Desde la consola Bash de PythonAnywhere, ejecuta:

   ```bash
   mkdir -p "$HOME/instance"
   chmod 700 "$HOME/instance"
   python -c "from pathlib import Path; import secrets; p=Path.home()/'.bimbostock-secret'; p.write_text(secrets.token_urlsafe(48)); p.chmod(0o600)"
   export BIMBOSTOCK_SECRET_KEY="$(cat "$HOME/.bimbostock-secret")"
   export BIMBOSTOCK_DATABASE="$HOME/instance/bimbostock.sqlite3"
   export BIMBOSTOCK_COOKIE_SECURE=1
   cd "$HOME/<CARPETA-DEL-REPOSITORIO>"
   workon bimbostock
   python -m flask --app backend init-users
   ```

   Sustituye `<CARPETA-DEL-REPOSITORIO>` por la carpeta donde clonaste el proyecto. El último comando solicita en la consola las cuatro contraseñas nuevas. No copies el valor de la clave de sesión ni las contraseñas a GitHub, `config.js` o capturas de pantalla.
4. En la pestaña **Web**, abre el archivo WSGI que muestra el panel. Sustituye su contenido por este ejemplo y cambia `TU_USUARIO` y `CARPETA-DEL-REPOSITORIO` por tus propios valores:

   ```python
   import os
   import sys

   project = "/home/TU_USUARIO/CARPETA-DEL-REPOSITORIO"
   if project not in sys.path:
       sys.path.insert(0, project)

   os.environ["BIMBOSTOCK_SECRET_KEY"] = open(
       "/home/TU_USUARIO/.bimbostock-secret", encoding="utf-8"
   ).read().strip()
   os.environ["BIMBOSTOCK_DATABASE"] = "/home/TU_USUARIO/instance/bimbostock.sqlite3"
   os.environ["BIMBOSTOCK_COOKIE_SECURE"] = "1"

   from backend import create_app
   application = create_app()
   ```

   Guarda el archivo y pulsa **Reload**. Abre la URL HTTPS que aparece en la pestaña **Web**, inicia sesión con la cuenta administradora y agrega el inventario inicial. El archivo WSGI y la clave se quedan en tu cuenta del proveedor, no en el repositorio.

En esta arquitectura Flask sirve también `index.html`, `app.js`, `styles.css` y `config.js`; deja `window.BIMBOSTOCK_API_URL = ""`. La base se guarda en el directorio de tu cuenta, no en el almacenamiento temporal del navegador ni en una capa efímera de contenedor. Configura y verifica copias de seguridad de `instance/bimbostock.sqlite3`; el almacenamiento persistente no sustituye una copia de seguridad. No publiques la base, claves, hashes de contraseñas ni respaldos.

### GitHub Pages y otros contenedores

GitHub Pages no puede ejecutar el backend. Si deseas publicar solamente el frontend allí, el API tiene que vivir en otra dirección HTTPS: define `window.BIMBOSTOCK_API_URL` en `config.js`, autoriza el origen exacto en `BIMBOSTOCK_ALLOWED_ORIGINS` y configura cookies `Secure` y `SameSite=None`. Algunos navegadores bloquean cookies de terceros, por lo que es preferible mantener la web y la API bajo el mismo sitio o usar un proxy del mismo sitio.

No uses un contenedor gratuito con disco efímero para producción con SQLite: sus datos pueden desaparecer al reiniciar o volver a publicar la aplicación. Render documenta que el disco persistente se ofrece para servicios pagados: <https://render.com/docs/disks>. Si eliges otro contenedor, confirma primero que proporciona almacenamiento persistente compatible con SQLite y revisa sus límites, política de suspensión, copias de seguridad y condiciones del plan gratuito.

## Estructura

```text
backend.py          API Flask, autenticación, permisos y operaciones SQLite
instance/           Base de datos local (ignorada por Git)
index.html          Interfaz de BimboStock y pantalla de inicio de sesión
app.js              Cliente web y presentación de datos del API
config.js           URL configurable del API
styles.css          Diseño responsivo
requirements.txt    Dependencias del backend
tests/              Pruebas automatizadas de permisos, sesión y PEPS
```

Protege la clave de Flask y las copias de SQLite como secretos/datos privados. No publiques la base de datos, hashes de contraseñas ni respaldos en GitHub o GitHub Pages.
