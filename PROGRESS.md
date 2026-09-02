# Historial del proyecto de escritorio

Registro condensado de hitos y decisiones. El estado actual, la arquitectura y las reglas viven en `CLAUDE.md`; aquí solo queda el porqué de las decisiones que ya no se deducen del código. La versión Tauri (`RiftCompass-Tauri`) se retiró el 2026-08-31 y su repo de GitHub se borró; este fichero es lo único que queda de esa etapa.

## Etapa Tauri (hasta 2026-08-31)

- **App completa en Tauri v2 + Rust**: 11 herramientas, i18n, perfiles (búsqueda, comparación, guardados con carpetas sincronizados con la cuenta de riftcompass.com), ajustes, app de bandeja con arranque en segundo plano, LCU completo (lockfile + REST + WebSocket), Live Client Data, importación de builds, overlay in-game.
- **Perfil con el mismo look que la web (2026-08-28)**: se descartó el estilo propio distinto que tenía la app; desde entonces el perfil replica la visualización de la web sobre el mismo payload de `/api/v1/profile`.
- **Overlay**: CS/min, oro por carril y objetivos solo con Tab mantenido (como iTero/Porofessor), timers de dragón/larvas/heraldo/barón, hechizos rivales con cuenta atrás manual, sugerencia de habilidad y build recomendada desde el crawler de la web, calibración manual de la barra de habilidades (Live Client Data no expone coordenadas de pantalla). Iconos reales del atlas de minimapa de Community Dragon (el único que tiene icono de larvas). Descartado: timers de campamentos de jungla y ulti rival (sin API oficial sin saltarse Vanguard); línea de tiempo de intercambio en Cooldown Comparator (asume rangos de habilidad del rival que no se pueden saber).
- **La app nunca toca `game.cfg`**: hubo una versión que reescribía `WindowMode` a Borderless para que el overlay se viera; se revirtió por completo. En pantalla completa exclusiva el overlay simplemente no se ve (límite de DWM), y ese límite es el motivo de la migración a Electron.
- **Bugs reales encontrados en partida** (todos arreglados y conservados en Electron): evento de teardown del LCU sin `myTeam`; `assignedPosition` en mayúsculas en personalizadas; Live Client Data localiza los nombres de campeones bot en el idioma del cliente (este último solo se detectó al depurar con logging real durante la migración, existía desde siempre).
- **Click-through bajo demanda**: en Tauri/WebView2 `onMouseEnter` no llegaba a una ventana click-through, así que ni arrastrar paneles ni el botón de aplicar build funcionaron nunca en partida real. Electron lo resuelve con `setIgnoreMouseEvents(true, { forward: true })`.
- **Auditoría de rendimiento (2026-08-27)**: la arquitectura ya era por eventos (WebSocket del LCU), sin `setInterval`/`rAF` en el frontend; solo polling barato del lockfile (2.5s sin cliente) y de Live Client Data (3s en partida).
- **Riot API key**: Personal API Key permanente desde 2026-08-27 (App 875077).
- **Overwolf (2026-08-30)**: formulario de propuesta de app enviado; Overwolf respondió exigiendo aprobación previa de Riot Games. Detalle en `docs/overwolf-registration.md`.

## Migración a Electron (2026-08-30 a 2026-08-31)

- Backend Rust portado módulo a módulo a `electron/*.ts`; frontend `src/` reutilizado casi sin cambios (solo `bridge/index.ts` y `WindowControls.tsx` tocaban la API nativa). Mismo aspecto visual, mismo backend remoto.
- Bug real encontrado: Electron 20+ sandboxa el preload por defecto, lo que bloqueaba en silencio todo `window.riftcompass` (ver Gotchas en `CLAUDE.md`).
- Verificado end-to-end contra el LCU real: detección del cliente, auto-apertura, perfil con datos reales, sesión de cuenta persistida (DPAPI) y validada contra `/api/v1/me`. Cuatro partidas personalizadas seguidas resolviendo los 5 carriles propios.
- Empaquetado (`electron-builder --dir`), icono propio, acceso directo del escritorio apuntando a `release/win-unpacked/RiftCompass.exe`, CSP inicial, `.gitignore`. `RiftCompass-Tauri/` borrada tras confirmar paridad.

## Pulido y auditoría (2026-09-01)

- Perfil: navegación real por meses en el calendario (endpoint `/api/v1/activity-calendar`, lógica portada también a la web), botón Comparar como `DropdownMenu` anclado (con `data-rc-dropdown` para que los desplegables anidados no cuenten como "clic fuera"), "Buscar de nuevo" como popover, tarjetas reagrupadas por altura natural.
- Seguridad: CSP movida a cabecera real desde el proceso principal para que `unsafe-eval` sea solo de dev; `preload.ts` valida canales contra el allowlist; rayas largas eliminadas de los textos de UI.
- Código: `ProfileScreen.tsx` (2851 líneas) dividido en `src/profile/`; estilos duplicados consolidados en `src/theme.ts`; comentarios estilo diario limpiados.
- Repo propio en GitHub (`juliolpzsu/RiftCompass-Electron`), público desde 2026-09-01 para que GitHub Releases sirva de canal de auto-update sin token embebido.
- Distribución: `electron-updater` + GitHub Releases, `npm run release`, EULA en el instalador, primer Release `v0.1.0`, botón de descarga activado en la web. Sentry integrado y verificado en ambos procesos. Firma de código pospuesta.

## Diseño (2026-09-02)

- Réplica de la auditoría de diseño de la web: eliminado el resplandor ambiental sintético (blob morado, luego rosa de los vientos), migración `lucide-react` → `@phosphor-icons/react` (12 ficheros), tres splash accents por herramienta con los mismos campeones que la web (tamaños reducidos porque el panel no tiene los márgenes anchos de la web).
- Perfil: leyenda del calendario alineada al borde de la tarjeta (mismo patrón que la web), Champion Pool + Roadmap emparejados en una fila (solo escritorio, divergencia deliberada), Champion Pool rediseñado con señal de concentración por rol y "última partida hace X" (mismo cambio que la web).
- Bug sistémico `FiddleSticks`/`Fiddlesticks` arreglado en la raíz con `toDDragonId()` (afectaba a Meta Tier List, Draft Simulator, Personality Test y Tier List).

## Auditoría de seguridad y coherencia (2026-09-02)

- Ventanas bloqueadas a su propio renderer (sin navegación externa ni `window.open`).
- El passthrough genérico al LCU desde el renderer (`lcu_request`, cualquier método y ruta) se sustituyó por `lcu_get`, solo lectura y con allowlist de rutas.
- Eliminadas las referencias a ficheros Rust ya inexistentes y los comentarios con citas y fechas; documentación reescrita como referencia de estado en vez de diario.
