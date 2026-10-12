# BimboStock — Gestión de inventario y punto de venta

Aplicación web ligera para administrar un expendio de pan con control de inventario por lotes, semaforización de caducidades y punto de venta con rotación **PEPS** (Primero en Entrar, Primero en Salir).

## Funcionalidades

- **Panel de control:** valor del inventario, existencias, productos activos, lotes próximos a caducar, gráfica semanal de ventas y resumen visual del semáforo.
- **Inventario por lotes:** registra SKU, producto, lote, fecha de entrada, caducidad, unidades, costo y precio de venta. Busca lotes y elimina registros que ya no deban estar en el sistema.
- **Semáforo de caducidad:** verde para más de 30 días; amarillo para 8–30 días; rojo para 0–7 días o producto caducado. Los lotes sin existencias no aparecen en las alertas del panel.
- **Punto de venta:** filtra por categoría o texto, arma un ticket, cambia cantidades y elige efectivo, tarjeta o transferencia.
- **PEPS al cobrar:** las unidades se descuentan de los lotes del SKU vendido ordenados por fecha de entrada ascendente (el lote recibido primero sale primero). Si coinciden las fechas de entrada, se prioriza la caducidad más próxima.
- **Historial de ventas:** consulta los tickets guardados en el dispositivo.
- **Persistencia local:** inventario y ventas se guardan en `localStorage`; no hace falta configurar un servidor ni instalar paquetes.
- **Interfaz adaptable:** panel lateral, tablas, catálogo de productos y caja utilizables desde escritorio, tableta y móvil.

## Requisitos

- Navegador moderno con JavaScript habilitado (Chrome, Edge, Firefox o Safari).
- No requiere Node.js, Python, base de datos ni dependencias externas.
- Conexión a internet únicamente para cargar las fuentes DM Sans y Manrope de Google Fonts. Si no está disponible, se utilizan fuentes del sistema.

## Uso local

1. Descarga o clona este repositorio.
2. Abre `index.html` en un navegador.
3. Entra en **Inventario → Registrar lote** para capturar tus productos y lotes.
4. Abre **Punto de venta**, agrega productos y cobra. La existencia se actualizará de acuerdo con PEPS.

También puedes servir la carpeta con cualquier servidor estático. Por ejemplo, si ya tienes Python instalado:

```bash
python -m http.server 8000
```

Después visita <http://localhost:8000>.

La primera visita carga datos de demostración para explorar el sistema. Los cambios posteriores se guardan en el almacenamiento local del navegador. Para borrar esos datos de prueba, abre las herramientas de desarrollo del navegador, elimina la clave `bimbostock-data-v1` de `localStorage` y recarga la página. El almacenamiento es por navegador y dispositivo: esta versión no sincroniza usuarios ni sucursales.

## Estructura del proyecto

```text
bimbostock/
├── index.html   # Estructura y pantallas de la aplicación
├── styles.css   # Diseño responsivo y componentes visuales
├── app.js       # Lógica del inventario, semáforo, PEPS y ventas
├── README.md    # Documentación e instrucciones
└── .gitignore   # Archivos locales que Git debe ignorar
```

## Semáforo y rotación

Los días restantes se calculan respecto a la fecha local del navegador. El estado rojo incluye los lotes cuya caducidad es hoy, además de los ya caducados. Para vender, el sistema utiliza el stock disponible de lotes no caducados y ordena esos lotes por fecha de entrada más antigua. El semáforo avisa de la caducidad; PEPS mantiene su criterio propio de orden de entrada.

## Publicar en GitHub

### 1. Inicializar Git

Abre una terminal en la carpeta del proyecto y ejecuta:

```bash
git init
git add .
git commit -m "Initial commit: BimboStock inventory and POS"
git branch -M main
```

### 2. Crear un repositorio en GitHub

Crea un repositorio vacío en <https://github.com/new>. No agregues README, `.gitignore` ni licencia en GitHub si ya conservas los archivos de este proyecto.

### 3. Conectar y subir

Sustituye `TU_USUARIO` por tu usuario u organización y `NOMBRE_REPOSITORIO` por el nombre elegido:

```bash
git remote add origin https://github.com/TU_USUARIO/NOMBRE_REPOSITORIO.git
git push -u origin main
```

En las siguientes actualizaciones:

```bash
git add .
git commit -m "Describe el cambio"
git push
```

GitHub puede solicitar que te autentiques con el navegador, GitHub CLI o un administrador de credenciales. No incluyas tokens ni contraseñas en la URL del remoto.

### Publicar como sitio web (opcional)

Para alojar la aplicación con GitHub Pages, entra a **Settings → Pages**, elige **Deploy from a branch**, selecciona `main` y la carpeta `/ (root)`, y guarda. La URL del sitio aparecerá en esa sección al terminar la publicación.

## Limitaciones y siguientes pasos

Esta versión es una base funcional de frontend para demostración y operación local. `localStorage` no es una base de datos compartida y puede borrarse desde el navegador; los tickets no son comprobantes fiscales. Para operar con varias cajas o sucursales, usuarios concurrentes, respaldos, permisos, impresión fiscal y sincronización en tiempo real, hace falta integrar un backend y una base de datos con autenticación.
