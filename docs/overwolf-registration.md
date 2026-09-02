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

## Progreso real (2026-09-02) — el código ya está escrito, falta el permiso de inyección

**Hallazgo que cambia el plan de arriba**: `@overwolf/ow-electron`,
`@overwolf/ow-electron-builder` y `@overwolf/ow-electron-packages-types`
resultaron estar **publicados públicamente en npm sin ninguna restricción de
instalación** (verificado con `npm view`, y ya instalados como
devDependencies aquí). Lo que Overwolf condiciona a la aprobación de Riot no
es poder instalar los paquetes — es que la inyección real en el proceso de
League llegue a funcionar (whitelisting del lado de su servidor). Esto
significa que el Paso 4 ya se pudo escribir entero, con los tipos reales, sin
esperar a nada:

- **`electron/overlayEngine.ts`** (nuevo): la integración real contra
  `IOverwolfOverlayApi` — `registerGames({ gamesIds: [kGameIds.LeagueofLegends] })`,
  `game-launched` → `event.inject()`, `game-injected` → crea la ventana
  overlay real vía `overlayApi.createWindow()` (mismo renderer/preload de
  siempre, solo que inyectada en el proceso del juego en vez de una ventana
  normal), `game-exit` → la oculta. Verificado línea a línea contra el propio
  repo oficial de ejemplo de Overwolf
  (`github.com/overwolf/ow-electron-packages-sample`), no adivinado.
- **`electron/windows.ts`**: `createOverlayWindow()` (el camino de Electron
  normal) queda intacto; `getOverlayWindow()`/`showOverlay()`/
  `setOverlayInteractive()`/`broadcast()` ahora soportan ambos caminos sin
  que main.ts/gameConnection.ts/ipc.ts hayan tenido que cambiar una sola
  llamada — justo el "único punto de cambio" que ya se preveía.
- **`electron/main.ts`**: `isOverwolfRuntime()` decide en el arranque cuál de
  los dos caminos usar. Bajo el binario `electron` normal (la única
  distribución real hoy) es exactamente el mismo comportamiento que antes de
  este cambio — verificado en real con `npm run dev`, arranca limpio.
- **`package.json`**: añadido el campo `"overwolf": { "packages": ["overlay"] }`
  y un script nuevo `npm run dev:overwolf`, que lanza la app con el binario
  real `ow-electron` en vez de `electron` (ya descargado, `npx ow-electron
  --version` funciona). Sin la aprobación de Riot, `registerGames`/la
  inyección real simplemente no harán nada útil todavía, pero esto permite
  confirmar que `app.overwolf` existe y que la app arranca bajo el runtime
  real sin esperar a nada más — **pendiente de probar en real** (no se
  lanzó hoy por no interrumpir al usuario, que tenía el ordenador en uso
  con otra cosa en ese momento).

## Qué queda pendiente de verdad

- Lo de siempre: Julio pide acceso en el Riot Developer Portal, Overwolf
  whitelista la app tras verlo.
- Una vez llegue: probar `npm run dev:overwolf` con League realmente
  abierto (registro del juego, inyección, ventana overlay real apareciendo
  sobre pantalla completa exclusiva) — el código ya escrito debería
  funcionar tal cual, pero esto es la primera vez que se podrá verificar de
  verdad contra el juego real.
- Cuando eso funcione: cambiar `electron-builder` por
  `@overwolf/ow-electron-builder` en los scripts `dist`/`release`/`pack:dir`
  para que el instalador final también empaquete el binario `ow-electron`
  en vez del `electron` normal (hoy sigue en `electron-builder` a propósito,
  ya que el binario que se distribuye de verdad todavía es el normal).
