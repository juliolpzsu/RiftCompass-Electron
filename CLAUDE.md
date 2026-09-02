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
- **Bug real, sistémico, encontrado 2026-09-02 (Julio: "el icono de
  fidlesticks... en la meta tierlist no se ve, puede que esto afecte
  tambien a otras areas")**: Match-V5/Spectator/el crawler propio
  escriben el nombre de este campeón como `"FiddleSticks"` (S
  mayúscula); el id real de Data Dragon (y el nombre del archivo del
  icono) es `"Fiddlesticks"` (s minúscula) — la misma inconsistencia
  real de la API de Riot que la web ya documenta y arregla en su propio
  `ddragon.ts`. Electron nunca portó ese arreglo, y no era un caso
  aislado: `championSquareUrl` construía la URL del icono directo del
  nombre crudo (rompía en cualquier sitio que la llamase con un
  `championName` real, no solo Meta Tier List) y otros 3 sitios
  comparaban ese nombre crudo contra `ChampionInfo.internalId` con
  igualdad exacta, sin normalizar: `draft-help.ts` (sugerencias de
  Draft Simulator), `PersonalityTest.tsx` (badge de winrate real),
  `TierListBuilder.tsx` (badge de tier real). Arreglado en la raíz:
  `toDDragonId()` nuevo en `ddragon.ts` (tabla de excepciones, mismo
  patrón que `CHAMPION_NAME_DDRAGON_OVERRIDES` de la web) aplicado
  dentro de `championSquareUrl` (cubre `ProfileDetail.tsx` y cualquier
  otro caller sin tocarlos) y en los 3 sitios de comparación exacta.
  **Verificado de verdad, no solo a ojo**: con la app en marcha,
  `[...document.images].filter(img => img.complete && img.naturalWidth
  === 0)` en la consola de DevTools de la propia app devolvió `[]` —
  cero imágenes rotas en Meta Tier List tras el arreglo.

## Estado

App en producción, con paridad funcional completa respecto a la versión
Tauri retirada (y con al menos una corrección real que esa versión nunca
tuvo — ver el gotcha de Live Client Data arriba). Ver `PROGRESS.md` para
el historial completo de la migración. Pendiente real: Overwolf exige
también aprobación de Riot Games antes de dar acceso a
`@overwolf/ow-electron*` (ver `docs/overwolf-registration.md`) — hasta
que llegue, el overlay in-game solo se ve en Borderless/Windowed, no en
pantalla completa exclusiva real.

## Pendiente: distribución y auto-actualización (2026-09-01)

Ahora mismo `npm run dist` genera un instalador NSIS funcional
(`release/RiftCompass Setup 0.1.0.exe`) pero nada más: sin comprobación
de versión, sin publicación a ningún sitio, sin firma. El botón de
descarga en la web (`DownloadAppButton`) está inerte a propósito hasta
que esto exista. Camino elegido: `electron-updater` + GitHub Releases
(el repo ya vive en `juliolpzsu/RiftCompass-Electron`), para que quien ya
tenga la app instalada la reciba sola en segundo plano, sin volver a
descargar el instalador a mano — eso solo hace falta para una instalación
nueva en un equipo que nunca tuvo la app.

- [x] **`electron-updater` integrado (2026-09-01)**: `electron/updater.ts`
      (`startAutoUpdater()`, llamado desde `main.ts` junto al resto del
      arranque) — descarga automática y silenciosa
      (`autoDownload = true`), se instala sola al cerrar la app
      (`autoInstallOnAppQuit = true`, sin diálogo que aceptar), comprueba
      al arrancar y cada 4h mientras la app vive en bandeja. Solo corre
      en build empaquetada (`app.isPackaged`) — en dev no existe
      `app-update.yml`, así que no intenta nada.
- [x] Bloque `publish` (`provider: github`, owner `juliolpzsu`, repo
      `RiftCompass-Electron`) añadido a `electron-builder.yml`.
- [x] Script `npm run release` (`electron-builder --publish always`) en
      `package.json` — necesita `GH_TOKEN` en el entorno para poder subir
      el asset al Release de GitHub; sube el `.exe` y genera el
      `latest.yml` que `electron-updater` consulta. **Probado de punta a
      punta** (ver Release `v0.1.0` abajo). Gotcha real encontrado:
      `electron-builder` puede dejar una carpeta `release\win-unpacked`
      con un lock transitorio (Explorer/antivirus) que rompe la
      extracción del binario de Electron con `EPERM` — si pasa, borrar
      `release\win-unpacked*` y reintentar.
- [x] **`DownloadAppButton` reactivado en la web (2026-09-01)**: era un
      `div` inerte, ahora es un `<a>` real a
      `github.com/juliolpzsu/RiftCompass-Electron/releases/download/v0.1.0/RiftCompass-Setup-0.1.0.exe`,
      badge "Coming soon" → "Windows". **Deuda real**: el nombre del
      asset lleva la versión (`electron-builder` los nombra
      `RiftCompass-Setup-<version>.exe` por defecto), así que este
      enlace hay que actualizarlo a mano en cada release. Fijar un
      `artifactName` sin versión en `electron-builder.yml` (p. ej.
      `RiftCompass-Setup.exe`) en el próximo release real permitiría
      pasar a la URL estable
      `.../releases/latest/download/RiftCompass-Setup.exe` y no volver
      a tocar la web. No se hizo en este release por no forzar una
      republicación solo por esto.
- [x] **Repo hecho público (2026-09-01)**: `RiftCompass-Electron` era
      privado — un Release ahí no es descargable por nadie anónimo ni
      sirve para que `electron-updater` compruebe versiones sin exponer
      un token dentro del propio instalador. Julio confirmó hacerlo
      público (código sin secretos verificado antes de publicar: sin
      `.env`, sin tokens, sin firma real embebida — ver commit
      "Document the distribution and auto-update plan" y el Release
      `v0.1.0`).
- [x] **Primer Release real publicado**: `v0.1.0`
      (github.com/juliolpzsu/RiftCompass-Electron/releases/tag/v0.1.0),
      con `latest.yml` + `RiftCompass-Setup-0.1.0.exe`, marcado como
      Latest. Verificado antes de publicar: `app.asar` solo contiene
      `dist/`, `dist-electron/`, `package.json` y deps de producción
      (sin código fuente TS ni `.env`), sin secretos embebidos (grep
      dirigido sin coincidencias), sin firma real (`NotSigned` en los 3
      `.exe` — pendiente real, ver punto de firma de código arriba).
- [ ] **Firma de código: pospuesta a propósito (2026-09-01)** — Julio no
      quiere gastar en el cert OV/EV (~100-300€/año) hasta que la app
      sea rentable. Sin firmar, el `.exe` dispara el aviso de SmartScreen
      "Editor desconocido" en el primer arranque y puede dar falso
      positivo de algún antivirus — asumido mientras tanto. Retomar
      cuando haya ingresos reales, no antes.
- [x] **Telemetría de errores — verificada de punta a punta (2026-09-01)**:
      `@sentry/electron` integrado en los dos procesos —
      `electron/telemetry.ts` (`initTelemetry()`, llamado al inicio de
      `main.ts`, antes que cualquier otra cosa pueda lanzar) para
      crashes/errores del proceso principal (que no se ven en DevTools,
      ver Gotchas), y `src/telemetry.ts` (llamado al inicio de
      `main.tsx`) para errores del renderer/React. DSN real en
      `src/shared/telemetry.ts::SENTRY_DSN` (proyecto Sentry "electron",
      org `riftcompass`, región UE — ver el `CLAUDE.md` raíz para la
      lista completa de servicios externos y a qué cuenta va cada uno).
      CSP (`main.ts`) permite `https://*.sentry.io` en `connect-src`.
      **Probado con dos errores reales lanzados desde la app en marcha**
      (`npm run dev`, `setTimeout(() => fnQueNoExiste(), 10)` en la
      consola del renderer — lanzarlo directo sin `setTimeout` NO vale,
      un error evaluado directo en la consola de DevTools no pasa por
      `window.onerror` y Sentry nunca lo ve): ambos llegaron al dashboard
      de Sentry en segundos, revisados y borrados tras confirmar (eran
      solo ruido de prueba). El DSN vacío sigue soportado como no-op para
      cualquier entorno donde no se quiera reportar (confirmado antes de
      tener el DSN real: build y `npm run dev` arrancaban limpios).
- [x] **Compatibilidad hacia atrás de `/api/v1/*` documentada
      (2026-09-01)**: política explícita en `RiftCompass-Web/CLAUDE.md`
      (sección "API pública v1") — cambios aditivos únicamente, una
      ruptura real va a `/api/v2/*` en vez de mutar `/v1`. No se añadió
      cabecera de versión de cliente sin un caso real que la necesite
      todavía (evitar la plomería especulativa).
- [x] **EULA en el instalador (2026-09-01)**: `build/eula.txt`
      (cobertura del producto, no afiliación con Riot, procesamiento
      local, licencia de uso personal, sin garantía, referencia a
      `riftcompass.com/legal` para la política de privacidad completa),
      enganchado vía `nsis.license` en `electron-builder.yml` — NSIS lo
      muestra antes de elegir carpeta de instalación.
- [ ] Cuando llegue la aprobación de Overwolf (ver arriba) y se sustituya
      `createOverlayWindow` por la API real, pensar esa build como una
      actualización más vía este mismo mecanismo, no como una
      reinstalación manual pedida a los usuarios.

## De-slopping tras auditoría de diseño (2026-09-02)

Réplica del arreglo del resplandor ambiental de la web (ver
`RiftCompass-Web/CLAUDE.md`, mismo apartado) — este proyecto ya lo copiaba
1:1 a propósito (`MainView.tsx`, comentario "Same ambient 'Glass & Depth'
glow as the web app's body::before"), así que el mismo problema (blob
morado genérico) y el mismo arreglo (rosa de los vientos vía
`repeating-conic-gradient`) aplicaban aquí también:

- **Glow principal** (`<main>`, arriba del todo): blob morado → rayos
  anclados al 90% (no al 80% que usa la web — aquí el glow vive dentro de
  `<main>`, que no incluye el riel de perfiles guardados, así que no hay
  nada que esquivar).
- **Glow secundario** (extensión de la cuadrícula de herramientas, más
  abajo en la página): morado → rosa. Era un wash de color plano sin
  forma de rayos (no anclado al mismo punto de origen que el compás
  principal, así que replicar rayos ahí habría quedado como líneas
  sueltas sin sentido) — cambiado a rosa para que el morado decorativo
  puro no se repita en un segundo sitio sin relación con su significado
  semántico real (color de victoria) ni con el compás.
- **No tocado**: la cuadrícula de herramientas de `MainView` (es
  lanzador/navegación como home/`/tools` de la web, no venta — el mismo
  criterio que se aplicó allí) y las etiquetas en mayúsculas del HUD del
  overlay (`OverlayView.tsx`), que la propia auditoría marcó como
  correctas a esa escala.
- **`lucide-react` → `@phosphor-icons/react` (2026-09-02)**: 12 ficheros
  (mismo mapeo de nombres verificado que en la web, ver su `CLAUDE.md`
  para la tabla completa). A diferencia de la web, aquí se importa
  directo de `@phosphor-icons/react` (sin el sufijo `/dist/ssr`) — esta
  app es un SPA de Vite puro, sin React Server Components, así que el
  `IconContext` interno del paquete (el motivo real de tener que usar la
  ruta `/ssr` en Next.js, ver el gotcha en `RiftCompass-Web/CLAUDE.md`)
  nunca es un problema aquí.
- `npm run typecheck` limpio. **No verificado visualmente** — no se pudo
  screenshotear la app en el momento del cambio (Julio tenía un juego en
  pantalla completa exclusiva corriendo, que bloquea la composición de
  cualquier otra ventana, la misma limitación de Windows documentada
  arriba para el overlay). Pendiente real: confirmar en real la próxima
  vez que se abra la app.
- **Paridad de splash accents con la web (2026-09-02)**: `MainView.tsx`
  tenía UN solo `ChampionSplashAccent` compartido por herramienta
  (`TOOL_SPLASH_CHAMPION`, un campeón fijo por `openTool.id`, siempre
  arriba-derecha). Sustituido por `TOOL_SPLASH_ACCENTS`: 3 accents por
  herramienta con los mismos campeones que usa cada página equivalente
  de la web (mismo patrón en zigzag: primario+secundario en el mismo
  lado arriba/abajo, terciario al lado opuesto a media altura). Tamaños
  reescalados hacia abajo respecto a los de la web a propósito: el panel
  de herramienta aquí no tiene una columna centrada con márgenes anchos
  donde sangrar (ocupa el ancho completo de la ventana menos el riel de
  iconos), así que un accent del tamaño web (700-800px) se sentiría
  desproporcionado sin ese margen — quedaron en el rango ~340-560px.
  `npm run typecheck` limpio. **No verificado visualmente de punta a
  punta**: al lanzar `npm run dev` y traer la ventana al frente con
  automatización de escritorio, el intento de foco terminó sacando a
  primer plano otra ventana de terminal de Julio (otra sesión de Claude
  Code con un borrador sin enviar) — se abortó de inmediato para no
  interferir con esa sesión, sin tocarla ni su contenido, y se cerró
  limpiamente el proceso de Electron de desarrollo lanzado para esto.
  Sí se confirmó una captura de la pantalla de herramientas y de un
  panel de herramienta abierto antes de ese incidente (ambas
  renderizaban correctamente), pero no las 3-4 herramientas distintas
  que pedía la verificación completa. Pendiente real: confirmar
  visualmente cada accent la próxima vez que se abra la app con el
  escritorio despejado.
- **Perfil: leyenda del calendario, ChampionPool+Roadmap emparejados,
  pool rediseñado, última partida (2026-09-02)**: cuatro pedidos
  puntuales de Julio sobre `src/profile/ProfileDetail.tsx`.
  - **Leyenda del calendario desalineada**: en `ActivityCalendarCard`, la
    fila "Bad day/Good day" vivía DENTRO del mismo contenedor
    `maxWidth: 320, margin: "10px auto 0"` que centra la cuadrícula de
    días — quedaba centrada junto con la cuadrícula en vez de pegada al
    borde izquierdo real de la tarjeta, a diferencia de la web (donde la
    leyenda ya es hermana del contenedor centrado, no su hija, y por eso
    nunca tuvo este bug). Arreglado sacándola de ese contenedor a un
    hermano de ancho completo, mismo patrón que la web.
  - **ChampionPool + Roadmap emparejados** (pedido explícito, solo
    escritorio): iban cada uno a ancho completo, como en la web — ahora
    van en la misma fila `grid-template-columns:
    repeat(auto-fit,minmax(340px,1fr))` que ya usaba el par
    Calendar+ChampionOverview justo arriba. Divergencia deliberada de la
    web (que los mantiene apilados) — no aplicar esto ahí sin que lo
    pida.
  - **Champion Pool rediseñado + timestamp de última partida**: mismo
    cambio y mismo motivo que en la web — ver
    `RiftCompass-Web/CLAUDE.md` (sección de de-slopping, misma fecha)
    para el razonamiento completo. Aquí: `computeChampionPool()`
    (`src/lib/profile-analysis.ts`) gana un campo `totalGames` por rol;
    `ChampionPoolCard` antepone la señal de concentración (barra
    segmentada + "X% de partidas con {campeón}", dorado + "one-trick"
    desde 66%) a los chips de campeón ya existentes. Sin el CTA
    "Build a focused pool" que sí lleva la web — aquí requeriría
    enhebrar un callback de navegación desde `MainView` (dueño de
    `setOpenToolId`) hasta `ProfileDetail.tsx`, que hoy no existe, y no
    se justificaba solo por esto. `formatRelativeTime()` nuevo en
    `profile-analysis.ts` (puerto literal del de `src/lib/utils.ts` de
    la web) — "Last game {tiempo}" junto al nivel en la cabecera,
    mismo `Intl.RelativeTimeFormat` con `locale` real de `useI18n()`.
  - `npm run typecheck` limpio. No verificado visualmente (mismo motivo
    que el punto anterior — pendiente confirmar con la app abierta).
