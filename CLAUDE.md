# RiftCompass desktop (Electron)

App de escritorio companion de riftcompass.com para League of Legends
(Windows-only): herramientas, perfiles de jugador y detección del cliente
de League en local. **Reescritura en Electron de `RiftCompass-Tauri/`**
— mismo aspecto visual exacto, mismo backend remoto
(`https://riftcompass.com/api/v1/*`), arquitectura de proceso principal
distinta. La filosofía y reglas comunes del proyecto están en el
`CLAUDE.md` raíz (`../CLAUDE.md`).

## Por qué Electron y no Tauri (el motivo real de esta carpeta)

`RiftCompass-Tauri` funciona, pero su overlay in-game **no puede pintarse
sobre League cuando el juego está en modo Pantalla completa exclusiva**
(solo funciona en Borderless/Windowed). Esto no es un bug de esa app: en
Windows, mientras un proceso tiene exclusividad de pantalla completa real,
DWM (el compositor de ventanas) deja de componer nada por encima — ninguna
ventana externa puede dibujarse ahí, lo confirman independientemente la
documentación pública de Discord, OBS y Steam sobre sus propios overlays.

La única vía real para conseguirlo — la que usa iTero, el overlay que
Julio quería igualar — es el motor de overlay de **Overwolf**
(`ow-electron`): en vez de dibujar una ventana normal por encima, *hookea*
`Present`/`EndScene` dentro del propio proceso del juego, así que sí
puede pintar incluso en exclusivo. Ese motor es un fork de Electron y
**solo se puede integrar en una app construida sobre Electron** — no
existe forma de enchufarlo a Rust/Tauri. De ahí la migración completa:
para tener alguna vez overlay real en fullscreen exclusivo, la app tenía
que pasar a Electron primero.

**Estado de la integración de Overwolf (2026-08-30)**: la propuesta de
app se envió a Overwolf y respondieron pidiendo un paso adicional —
al ser un juego de Riot, exigen aprobación también de Riot Games (vía su
Developer Portal) antes de dar acceso a los paquetes `@overwolf/
ow-electron*`. Ver `docs/overwolf-registration.md` para el detalle
completo y el estado actual. **Mientras esa aprobación no llega, esta app
funciona con Electron "normal"** (mismas limitaciones de fullscreen que
la versión Tauri — no es una regresión, es paridad exacta en otro
framework) y el Paso 4 del plan de migración (sustituir la ventana
overlay por la API real de Overwolf) queda pendiente, aislado a un solo
punto de cambio futuro (`electron/windows.ts`'s `createOverlayWindow`).

## Arquitectura

- **Frontend** (`src/`): React + Vite, copiado casi sin cambios de
  `RiftCompass-Tauri/src/`. Toda la comunicación con el proceso principal
  pasa por `src/bridge/` — implementa `RiftCompassApi` (tipada en
  `src/riftcompass.d.ts`) sobre `window.__electronBridge__` (expuesto por
  `electron/preload.ts` vía `contextBridge`) y la instala en
  `window.riftcompass`. `src/bridge/commands.ts` es el allowlist de
  nombres de canal IPC — el proceso principal implementa exactamente esos
  nombres. En navegador normal (sin Electron) el bridge cae a stubs
  locales honestos, así que `npm run dev:renderer` funciona sin el main
  process.
- **Proceso principal** (`electron/`): `main.ts` (bootstrap: ventanas,
  tray, single-instance, atajo global), `windows.ts` (creación/lifecycle
  de la ventana principal y el overlay), `ipc.ts` (registro de todos los
  `ipcMain.handle`, el equivalente al `invoke_handler` de Tauri),
  `preload.ts`, `settings.ts`, `account.ts` + `dpapi.ts` (cuentas de
  riftcompass.com; token cifrado con DPAPI en reposo vía
  `@primno/dpapi`, nunca llega al renderer), `lcu.ts` (lockfile + REST +
  WebSocket del cliente de League), `liveclient.ts` (Live Client Data API
  en partida), `gameConnection.ts` (máquina de estados de conexión; emite
  los mismos eventos `lcu:*`/`champselect:*`/`livegame:*` que la versión
  Tauri), `buildImport.ts` (importar runas/spells del último game real),
  `tabWatch.ts` (detección de Tab mantenido vía FFI a `GetAsyncKeyState`
  con `koffi`, sin binarios nativos que compilar), `overlayTopmost.ts`,
  `tray.ts`.

Cada módulo de `electron/` lleva un comentario señalando de qué fichero
Rust venía portado 1:1 originalmente. `RiftCompass-Tauri/` ya no existe
(retirada el 2026-08-31 tras alcanzar paridad funcional completa aquí,
con su código fuente final conservado en GitHub —
github.com/juliolpzsu/RiftCompass-Tauri) — esos comentarios son la
referencia que queda de esa lógica, no hace falta re-derivarla desde
cero si algo necesita revisarse.

## Comportamiento clave

- App de bandeja: arranca con Windows en segundo plano (`--background`;
  desactivable en Ajustes y esa decisión se respeta siempre), la ventana
  se abre sola cuando se conecta el cliente de League, y la X solo la
  oculta — únicamente el Quit del tray termina el proceso.
- Ventana sin decoraciones: la franja de 40px de `MainView` es la barra
  de título (`WebkitAppRegion: "drag"` en su style, equivalente Electron
  del `data-tauri-drag-region` de la versión Tauri) con botones propios
  (`src/WindowControls.tsx`, hablando con `window.riftcompassWindow` —
  ver su doc comment en `riftcompass.d.ts` para por qué es una API
  separada de `RiftCompassApi`).
- La overlay HUD in-game existe y está activa (`ENABLE_OVERLAY = true` en
  `electron/main.ts`).
- Backend remoto: SOLO `https://riftcompass.com/api/v1/*` (las mismas
  cuentas y datos que la web). Los datos del cliente de League se
  procesan únicamente en local; jamás se suben a ningún servidor.

## Comandos

- `npm run dev:renderer` — frontend solo, en navegador (stubs locales),
  puerto 1421 (distinto del 1420 de `RiftCompass-Tauri` para poder tener
  ambas apps en desarrollo a la vez mientras dure la migración).
- `npm run dev` — app completa en modo dev (vite + proceso principal).
- `npm run typecheck` — gate del frontend y del proceso principal
  (dos tsconfig distintos: `tsconfig.json` para `src/`, ESM;
  `tsconfig.electron.json` para `electron/`, CommonJS).
- `npm run build` — build de producción de ambos.
- `npm run dist` — genera el instalador (`electron-builder`, NSIS,
  `release/`).

## Gotchas reales (cada una costó un bug)

- **Preload sandboxeado por defecto**: Electron 20+ sandboxa los scripts
  de preload salvo que se pase `sandbox: false` explícitamente en
  `webPreferences` — un preload sandboxeado NO puede hacer `require()` de
  módulos locales propios (solo un puñado de builtins de Electron/Node),
  así que `electron/preload.ts` importando `WINDOW_CHANNELS` desde
  `./windows` fallaba en silencio con "module not found" y dejaba
  `window.riftcompass` completamente sin instalar (todo caía al stub
  local, con errores de red falsos y ningún aviso claro de la causa real).
  `contextIsolation: true` (que sí se mantito) es la barrera que
  realmente importa — mantiene el *contenido de la página* sin acceso a
  Node pase lo que pase con `sandbox`; el propio preload es código de
  confianza nuestro.
- **`tsconfig.electron.json` comparte `src/bridge/commands.ts`** con el
  frontend (mismo allowlist de nombres de canal en ambos lados, fuente
  única) — por eso su `rootDir` es la raíz del proyecto y no solo
  `electron/`, y por eso `dist-electron/` tiene `electron/main.js` y
  `src/bridge/commands.js` en vez de todo plano.
- **Live Client Data localiza el nombre de un campeón controlado por bot
  en el idioma del propio cliente de League** (verificado en vivo:
  "Maestro Yi" para MasterYi, "Twisted Fate"/"Xin Zhao" con espacio bajo
  un cliente en español) — NO en el id interno inglés de Data Dragon que
  `championName` usa para jugadores reales. Por eso `ddragon.ts` indexa
  también por nombre normalizado en el locale real del cliente
  (`mergeLocalizedChampionNames`, usando el `gameClientLocale` que
  `gameConnection.ts` reenvía en `lcu:identity`) — comparar solo contra
  el id interno en inglés (como hacía el código original, heredado sin
  cambios de la versión Tauri) deja sin resolver cualquier campeón
  multi-palabra o traducido.
- `npmRebuild: false` en `electron-builder.yml`: `@primno/dpapi` y
  `koffi` ya traen binario prebuilt compatible con el runtime de
  Electron (comprobado en real: funcionan tal cual en `npm run dev`, que
  ya corre sobre el runtime de Electron) — el rebuild por defecto de
  electron-builder intenta invocar `node-gyp` sobre ellos igualmente y
  falla (les falta `node-addon-api`, que no usan).
- Para verificar contra LCU real: lanzar League con
  `RiotClientServices.exe --launch-product=league_of_legends
  --launch-patchline=live` (lanzar `LeagueClient.exe` directamente da
  "Acceso denegado", Vanguard protege su arranque directo).

## Estado

App en producción, con paridad funcional completa respecto a la versión
Tauri retirada (y con al menos una corrección real que esa versión nunca
tuvo — ver el gotcha de Live Client Data arriba). Ver `PROGRESS.md` para
el historial completo de la migración. Pendiente real: Overwolf exige
también aprobación de Riot Games antes de dar acceso a
`@overwolf/ow-electron*` (ver `docs/overwolf-registration.md`) — hasta
que llegue, el overlay in-game solo se ve en Borderless/Windowed, no en
pantalla completa exclusiva real.
