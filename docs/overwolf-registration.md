# Registro de desarrollador en Overwolf (ow-electron)

**Estado: enviado el 2026-08-30.** Julio creó la cuenta de desarrollador
(login con Google, `julio.lopez.suarez.03@gmail.com`) y Claude rellenó y
envió el formulario de propuesta de app en
<https://dev.overwolf.com/app-idea-form> con su autorización explícita.
Confirmación recibida: "Proposal Sent — We got you!" — Overwolf dice que
contactarán en unos días (revisar spam si no llega nada en 48h). Mientras
no llegue la aprobación, la cuenta queda en estado "Developer status:
Pending" (visible en el menú de perfil de dev.overwolf.com).

**Hallazgo importante durante el envío**: la documentación de Overwolf
dice explícitamente *"Overwolf currently doesn't approve private apps"* —
"privada" en su terminología significa "de uso personal, no pensada para
uso general", no "no listada en su tienda". RiftCompass, al distribuirse
con marca propia fuera de su tienda pero abierta a cualquier jugador desde
riftcompass.com, cuenta como **app pública** en su definición (cualquiera
puede descargarla y usarla, tiene ventana real, no es un proceso oculto)
— así se planteó en el formulario, evitando el motivo de rechazo más
directo que señala su propia documentación.

**Contenido real enviado** (en inglés, obligatorio — "Only proposals
submitted in English will be reviewed"):
- Nombre de la app: RiftCompass
- Sitio web: https://riftcompass.com
- Framework: ow-electron
- Modelo de negocio: None (sin monetización)
- Categorías: Stats, Utilities, Guides & Trainers
- Juego soportado: League of Legends
- Descripción (1341/1400 caracteres): explica qué hace la app (perfiles,
  11 herramientas, overlay con oro/objetivos/CS/build desde datos reales
  de Riot, import de build con un clic), qué fuentes usa (LCU + Live
  Client Data, mismas que Porofessor/Blitz/iTero, sin lectura de memoria
  ni hooks), y por qué se pide ow-electron (el overlay actual en Tauri no
  puede pintarse sobre League en modo Pantalla completa exclusiva).

## Respuesta de Overwolf — 2026-08-30, exige aprobación de Riot también

Overwolf contestó (developers@overwolf.com, "Thank you for your
submission") con una condición que no estaba prevista: como RiftCompass
es sobre un juego de Riot, **exigen también la aprobación de Riot Games**
antes de dar acceso a los paquetes `@overwolf/ow-electron*`, aunque la
app no vaya a usar la API oficial de Riot para nada. Texto literal
relevante:

> "Since your project involves one of Riot's games, you'll need to
> obtain their approval, even if you don't plan to use their API. [...]
> Details about the application process are available on the Riot
> Developer Portal. [...] To move forward with approving and whitelisting
> your idea, we'll need a screenshot of Riot's approval, including the
> app description you submitted to them."

Es decir: hay que solicitar acceso también en el Riot Developer Portal
(pidiendo el tipo de API key adecuado al proyecto), esperar su
aprobación, y mandarle a Overwolf una captura de esa aprobación junto con
la descripción enviada a Riot. **Ese registro en el Riot Developer
Portal solo puede iniciarlo Julio** (cuenta propia, igual que pasó con
Overwolf) — Claude puede ayudar a redactar/rellenar la descripción de la
app una vez exista la cuenta, igual que se hizo aquí.

## Qué queda pendiente

- **Julio**: crear cuenta en el Riot Developer Portal y solicitar el tipo
  de API key adecuado para RiftCompass, siguiendo las reglas de
  cumplimiento de Riot enlazadas en su correo.
- Una vez Riot apruebe: mandar a Overwolf (developers@overwolf.com,
  respondiendo al hilo "Thank you for your submission") la captura de esa
  aprobación + la descripción enviada a Riot.
- Solo entonces Overwolf da acceso a `@overwolf/ow-electron`,
  `@overwolf/ow-electron-builder` y `@overwolf/electron-is-overwolf` —
  con eso se completa el Paso 4 de la migración a Electron (ver
  `RiftCompass-Electron/CLAUDE.md`).
- Si Riot u Overwolf piden más información o rechazan: revisar el motivo
  exacto contra la sección "Hallazgo importante" de arriba antes de
  reenviar.

## Notas para cuando retome esto Claude (tras la aprobación)

- Objetivo final ya decidido por Julio: el overlay debe verse también con
  el juego en pantalla completa exclusiva real (no solo Borderless).
- **La migración a Electron ya está en marcha, no es solo un plan**: ver
  `RiftCompass-Electron/` (proyecto hermano, `RiftCompass-Tauri/` sigue
  intacta) y su propio `CLAUDE.md` para arquitectura y estado. El puerto
  del frontend y de todo el backend Rust → Node está hecho y verificado
  visualmente (misma pinta exacta, navegación entre herramientas, tier
  list, ajustes). Falta: verificación end-to-end contra el LCU real con
  League abierto, y el Paso 4 (sustituir la ventana overlay "normal" por
  la API real de Overwolf) — bloqueado hasta que llegue este acceso.
- Paquetes a instalar en cuanto haya acceso: `@overwolf/ow-electron`,
  `@overwolf/ow-electron-builder`, `@overwolf/electron-is-overwolf`.
  Sustituyen la creación de ventana "normal" en
  `RiftCompass-Electron/electron/windows.ts`'s `createOverlayWindow` —
  único punto de cambio previsto para ese paso.
