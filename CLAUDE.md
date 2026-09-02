# RiftCompass desktop (Electron)

App de escritorio companion de riftcompass.com para League of Legends (Windows): herramientas, perfiles de jugador, detección del cliente de League en local y overlay in-game. Las reglas comunes del proyecto están en `../CLAUDE.md`; el historial de cómo se llegó hasta aquí (incluida la versión Tauri anterior) en `PROGRESS.md`.

## Por qué Electron

El overlay in-game de una ventana normal no puede pintarse sobre League en modo pantalla completa exclusiva: en Windows, mientras un proceso tiene exclusividad, DWM no compone nada encima (lo confirman independientemente Discord, OBS y Steam sobre sus propios overlays). La única vía real, la que usa iTero, es el motor de overlay de **Overwolf** (`ow-electron`), que hookea `Present`/`EndScene` dentro del proceso del juego y solo se integra en una app Electron. Por eso la app se reescribió desde Tauri/Rust a Electron.

**Estado**: Overwolf exige aprobación previa de Riot Games (Developer Portal) antes de dar acceso a los paquetes `@overwolf/ow-electron*`. Ver `docs/overwolf-registration.md` para el estado del trámite y qué queda. Mientras tanto la app corre sobre Electron normal: el overlay se ve en Borderless/Windowed, no en pantalla completa exclusiva. El cambio futuro queda aislado en `createOverlayWindow` (`electron/windows.ts`).

## Arquitectura

- **Frontend** (`src/`): React + Vite. Toda la comunicación con el proceso principal pasa por `src/bridge/`, que implementa `RiftCompassApi` (tipada en `src/riftcompass.d.ts`) sobre `window.__electronBridge__` (expuesto por `electron/preload.ts` vía `contextBridge`) y la instala en `window.riftcompass`. `src/bridge/commands.ts` es el allowlist de canales IPC; el proceso principal implementa exactamente esos nombres. En navegador (`npm run dev:renderer`) el bridge cae a stubs locales honestos.
- **Proceso principal** (`electron/`): `main.ts` (bootstrap, CSP, single-instance, atajo global Ctrl+Alt+R), `windows.ts` (ventana principal y overlay), `ipc.ts` (todos los `ipcMain.handle`), `preload.ts`, `settings.ts`, `account.ts` + `dpapi.ts` (cuentas de riftcompass.com; token cifrado con DPAPI en reposo, nunca llega al renderer), `lcu.ts` (lockfile + REST + WebSocket del cliente), `liveclient.ts` (Live Client Data en partida), `gameConnection.ts` (máquina de estados de conexión, emite `lcu:*`/`champselect:*`/`livegame:*`), `buildImport.ts` (aplicar runas/hechizos vía LCU), `tabWatch.ts` (Tab mantenido vía `GetAsyncKeyState` con `koffi`), `overlayTopmost.ts` (reafirma always-on-top cada 1.5s), `tray.ts`, `updater.ts`, `telemetry.ts`.
- **Perfil** (`src/profile/`): `ProfileShared.tsx` (búsqueda/fetch, `DropdownMenu`, `PlatformSelect`), `ProfileDetail.tsx`, `ProfileCompare.tsx`. Misma visualización que la web a partir del mismo payload de `/api/v1/profile`; los cálculos (roadmap, radar, pool) viven en `src/lib/profile-analysis.ts`.
- **Copias compartidas con la web** (`src/lib/`): `champion-roles.ts`, `champion-damage-type.ts`, `champion-pool-builder.ts`, `draft-order.ts`, `jungle-xp.ts`, `personality-test.ts`, `tier-colors.ts`, `rank-lp.ts` y `tools/goldShopData.ts` son puertos de sus equivalentes en `RiftCompass-Web/src/lib/`. La lógica y los datos deben coincidir; solo difieren tipos de entrada (`ChampionInfo` vs `ChampionSummary`) y detalles de plataforma (clases Tailwind vs hex). Un cambio en uno se replica en el otro.
- **Estilos**: `src/theme.ts` (constantes/funciones de estilo compartidas) + `src/global.css`. Inline styles en React, no Tailwind.
- **i18n**: `src/i18n/messages/{en,es,fr,de}.ts`, `en.ts` es la forma canónica contra la que se tipan las demás. Copy de herramientas copiado literalmente de `RiftCompass-Web/messages/en.json`.

## Modelo de seguridad

- `contextIsolation: true`, `nodeIntegration: false`. `sandbox: false` solo porque un preload sandboxeado no puede hacer `require()` de módulos locales (ver Gotchas); la barrera real es `contextIsolation`.
- `preload.ts` valida cada canal contra el allowlist de `CMD`/`EVT` antes de reenviarlo; `ipc.ts` vuelve a validar lo que importa (`shell_open_external` solo abre `https://riftcompass.com`; `lcu_get` solo sirve GET a las rutas LCU listadas en `RENDERER_READABLE_LCU_PATHS`, el resto de llamadas al LCU viven en el proceso principal detrás de comandos concretos).
- Ambas ventanas rechazan cualquier navegación fuera del propio renderer y cualquier `window.open` (`lockToOwnRenderer` en `windows.ts`).
- CSP como cabecera real desde `main.ts` (`applyContentSecurityPolicy`): `'unsafe-eval'`/`'unsafe-inline'` en `script-src` solo en dev (Vite los necesita), nunca en la build empaquetada. `connect-src` limitado a Data Dragon, Community Dragon, riftcompass.com y Sentry.
- El token de cuenta (90 días) se guarda cifrado con DPAPI (`session.dat` en `userData`); sin DPAPI no se persiste. Solo un 401 de `/api/v1/me` cierra la sesión; un fallo de red mantiene el usuario cacheado.
- Los datos del cliente de League se procesan solo en local; jamás se suben a ningún servidor.

## Comportamiento clave

- App de bandeja: arranca con Windows en segundo plano (`--background`, desactivable en Ajustes y esa decisión se respeta), la ventana se abre sola al conectar el cliente de League, la X solo oculta; únicamente Quit del tray termina el proceso.
- Ventana sin decoraciones: la franja de 40px de `MainView` es la barra de título (`WebkitAppRegion: "drag"`) con botones propios (`src/WindowControls.tsx` sobre `window.riftcompassWindow`, API separada de `RiftCompassApi`, ver su doc comment en `riftcompass.d.ts`).
- Overlay (`src/OverlayView.tsx`, `?view=overlay`): ventana transparente a pantalla completa, click-through por defecto; cada panel pide interactividad al pasar el ratón (`setIgnoreMouseEvents(true, { forward: true })` es lo que permite que `onMouseEnter` llegue). Paneles arrastrables con posición persistida. Módulos: oro por carril y objetivos (solo con Tab mantenido), CS/min contra el objetivo del elo real, timers de dragón/larvas/heraldo/barón (constantes de temporada al inicio del fichero, revisar cuando cambie la temporada), hechizos rivales con cuenta atrás manual, sugerencia de habilidad a subir, build recomendada y botón "Aplicar build" (runas + hechizos vía LCU; los objetos solo se muestran, no hay endpoint de compra), calibración manual de la barra de habilidades desde Ajustes.
- Sugerencias de pick en champ select (`src/draft-help.ts`): winrate real del crawler vía `/api/v1/champion-winrates`, heurístico de hueco de composición solo como relleno. Se muestra el rival de carril real, nunca un "counter" inventado.
- Resumen post-partida: al salir de `InProgress` se navega al perfil propio si el usuario está inactivo en Herramientas (mismo `openProfile` que el auto-centrado al conectar).
- Backend remoto: SOLO `https://riftcompass.com/api/v1/*`.
- **Divergencia deliberada respecto a la web**: en el perfil, Champion Pool y Roadmap van emparejados en una fila (la web los apila). No replicar en la web sin que se pida.

## Comandos

- `npm run dev:renderer`: frontend solo en navegador (stubs), puerto 1421.
- `npm run dev`: app completa (vite + proceso principal).
- `npm run typecheck`: dos tsconfig (`tsconfig.json` para `src/`, `tsconfig.electron.json` para `electron/`, CommonJS).
- `npm run build`, `npm run dist` (instalador NSIS en `release/`), `npm run release` (`electron-builder --publish always`, necesita `GH_TOKEN`).
- **Acceso directo del escritorio siempre al día**: `RiftCompass.lnk` en el escritorio de Julio apunta a `release/win-unpacked/RiftCompass.exe`, que NO se regenera solo. Tras cualquier cambio en `src/` o `electron/` que se dé por terminado (commit), regenerar ese build con `npm run pack:dir` antes de cerrar la sesión, para que la app que Julio abre desde el escritorio sea siempre la del código actual. Si la app está en ejecución, cerrarla desde el tray (Quit) primero; el exe en uso bloquea la copia. `pack:dir` existe porque `electron-builder --dir` a secas falla siempre aquí con `EPERM` al renombrar `win-unpacked.tmp` (ver Gotchas).
- Para probar contra el LCU real: lanzar League con `RiotClientServices.exe --launch-product=league_of_legends --launch-patchline=live` (lanzar `LeagueClient.exe` directo da "Acceso denegado" por Vanguard).
- Verificar en real, no solo con typecheck: el exe de desarrollo con `npm run dev`, capturas de la ventana con la skill de automatización de escritorio, y `[...document.images].filter(i => i.complete && i.naturalWidth === 0)` en DevTools para detectar iconos rotos.

## Distribución y auto-actualización

- `electron/updater.ts`: `electron-updater` contra GitHub Releases (`publish` en `electron-builder.yml`, repo público `juliolpzsu/RiftCompass-Electron`). Descarga silenciosa, instala al cerrar, comprueba al arrancar y cada 4h. Solo en build empaquetada.
- Release publicado: `v0.1.0` (`RiftCompass-Setup-0.1.0.exe` + `latest.yml`). `app.asar` solo contiene `dist/`, `dist-electron/`, `package.json` y deps de producción.
- El botón de descarga de la web (`DownloadAppButton`) apunta a la URL del asset con versión. **Deuda**: fijar `artifactName` sin versión (p. ej. `RiftCompass-Setup.exe`) en el próximo release para pasar a `.../releases/latest/download/...` y no tocar la web en cada release.
- EULA en el instalador (`build/eula.txt` vía `nsis.license`).
- **Firma de código pospuesta** hasta que la app sea rentable (cert OV/EV ~100-300 €/año); mientras, SmartScreen avisa de "Editor desconocido".
- Cuando llegue Overwolf, esa build se distribuye como una actualización más por este mecanismo.

## Telemetría

`@sentry/electron` en ambos procesos (`electron/telemetry.ts`, `src/telemetry.ts`), DSN en `src/shared/telemetry.ts` (proyecto "electron", org `riftcompass`, región UE; DSN vacío = no-op). Para probar desde DevTools hay que lanzar el error dentro de un `setTimeout`: un error evaluado directo en la consola no pasa por `window.onerror`.

## Gotchas

- **Preload sandboxeado por defecto** (Electron 20+): un preload sandboxeado no puede hacer `require()` de módulos locales, así que importar `WINDOW_CHANNELS`/`CMD` fallaba en silencio y `window.riftcompass` no se instalaba (todo caía al stub con errores de red falsos). De ahí `sandbox: false`.
- **`tsconfig.electron.json` comparte `src/bridge/commands.ts`** con el frontend: su `rootDir` es la raíz del proyecto y `dist-electron/` contiene `electron/main.js` y `src/bridge/commands.js`.
- **Live Client Data localiza el nombre de un campeón controlado por bot** en el idioma del cliente ("Maestro Yi", "Twisted Fate" con espacio), no en el id de Data Dragon. `ddragon.ts` indexa también por nombre normalizado en el locale real del cliente (`mergeLocalizedChampionNames`, con el `gameClientLocale` que llega en `lcu:identity`).
- **`FiddleSticks` vs `Fiddlesticks`**: Match-V5/Spectator/crawler escriben `FiddleSticks`; el id de Data Dragon es `Fiddlesticks`. `toDDragonId()` en `ddragon.ts` normaliza; usarlo antes de construir URLs de icono o comparar contra `internalId`.
- **`assignedPosition`** llega en mayúsculas en personalizadas con selector manual de rol y en minúsculas en colas normales: comparar siempre con `.toLowerCase()`.
- **Evento final de champ select**: el LCU manda un payload sin `myTeam` real al terminar; exigir `s.myTeam.length` antes de aceptar la actualización o el roster se vacía justo antes de `InProgress`.
- `npmRebuild: false` en `electron-builder.yml`: `@primno/dpapi` y `koffi` traen binario prebuilt; el rebuild por defecto invoca `node-gyp` y falla.
- `electron-builder --dir` falla en esta máquina con `EPERM` al renombrar `release\win-unpacked.tmp` → `win-unpacked` (algo, seguramente el antivirus escaneando el `electron.exe` recién extraído, retiene la carpeta en ese instante; borrar y reintentar no lo arregla). `scripts/pack-unpacked.mjs` (`npm run pack:dir`) lo evita descomprimiendo el zip de Electron ya cacheado por `@electron/get` y pasándolo como `electronDist`, con lo que electron-builder copia en vez de extraer y renombrar. El instalador (`npm run dist`) no pasa por ese renombrado y no lo necesita.
- Errores del proceso principal no se ven en DevTools; van a Sentry o a la consola del terminal de `npm run dev`.

## Pendiente

- Aprobación de Riot/Overwolf y sustitución de `createOverlayWindow` por la API real de Overwolf (`docs/overwolf-registration.md`).
- Confirmar visualmente los splash accents por herramienta (`TOOL_SPLASH_ACCENTS` en `MainView.tsx`) con la app abierta.
- `artifactName` sin versión en el próximo release (ver Distribución).
- Con bots en el equipo rival, champ select nunca reporta `championId` para `theirTeam`; comprobar en una partida emparejada con humanos si el oro por carril rival resuelve, y solo entonces investigar como bug.
- Preload empaquetado con un bundler para poder volver a `sandbox: true`.
