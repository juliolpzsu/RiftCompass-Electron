# Estado del proyecto

Actualizado: 2026-08-30.

## Qué funciona (verificado en real)

- **Overlay: revertido el auto-fix de WindowMode, oro por carril
  arreglado, objetivos tras Tab, panel de roster eliminado
  (2026-08-30)**: Julio no quería que la app tocase nunca el ajuste de
  vídeo de League — la sesión anterior reescribía `game.cfg` a Borderless
  en silencio al entrar a champ select para que el overlay se viera.
  Revertido por completo: `write_window_mode`/`read_window_mode` y los
  comandos/bridge que los exponían, eliminados; el banner de aviso en
  `MainView.tsx`, también. La app ya no toca ese archivo nunca — en
  Fullscreen exclusivo el overlay simplemente no se ve (mismo límite que
  Porofessor/Blitz, confirmado independientemente contra la documentación
  de Discord/OBS/Steam), en Borderless/Windowed se ve perfecto sin haber
  cambiado nada.
  - **Investigado en profundidad si hay otra vía para overlay-sobre-
    fullscreen-exclusivo sin tocar el ajuste**: no la hay dentro de
    Tauri/Rust. La única forma real (la que usa iTero, confirmado por el
    `owutility.dll` — un componente de Overwolf — en su carpeta de
    instalación) es enganchar el pipeline de render del propio juego
    (`Present`/`EndScene`), técnica que Overwolf ofrece vía su SDK
    `ow-electron` — pero ese SDK **es un fork de Electron**, no una
    librería que se pueda añadir a una app Rust/Tauri; usarlo exige
    reescribir la app entera en Electron. Julio decidió: sí, migrar
    (documentado como proyecto propio, ver `docs/` y el plan de sesión —
    pendiente real grande, no iniciado).
  - **Diferencia de oro por carril, causa real encontrada y arreglada**:
    no se veía nunca, en ningún modo. Causa 1: el evento final que manda
    la LCU al terminar champ select no es `null`, es un payload sin
    `myTeam` real (tipo evento "Delete" del JSON-API) — un guard
    `if (!session) return` no lo filtraba, y `setMyTeam(s.myTeam ?? [])`
    vaciaba el roster justo antes de que empezara `InProgress`.
    Arreglado exigiendo `s.myTeam.length` antes de aceptar la
    actualización (`OverlayView.tsx`). Causa 2 (independiente): en
    partidas personalizadas con selector manual de rol (el desplegable
    de posición en el lobby, antes de champ select), `assignedPosition`
    llega en mayúsculas (`"TOP"`) en vez de minúsculas (`"top"` — el
    formato que sí usan las colas normales/clasificatorias), rompiendo el
    `.find(p => p.assignedPosition === position)`. Arreglado con
    `.toLowerCase()` en el matching — mismo patrón que ya usan
    `ProfileScreen.tsx`, `DraftSimulator.tsx`, `ChampionPoolBuilder.tsx`,
    etc. para el mismo campo. **Verificado en partida real** con logging
    temporal a fichero (eliminado tras confirmar): `myTeam` pasó de `[]`
    a `[{champ: 122, pos: "top"}]` y el panel renderizó el icono real de
    Darius.
  - **Contador de objetivos oculto hasta mantener Tab**, igual que el
    oro: envuelto en la misma condición `tabHeld`. **Verificado en
    partida real**: sin Tab, ni oro ni objetivos se muestran; manteniendo
    Tab, ambos aparecen juntos.
  - **Panel de "Partida en vivo" (roster completo, 10 jugadores con
    items/hechizos/cooldowns) eliminado** — era "el overlay debajo del
    contador de objetivos" que Julio pidió quitar. Se queda solo
    objetivos + CS/min propio.
  - **Paneles de oro y objetivos arrastrables con el ratón mientras se
    mantiene Tab**: implementado (`useDraggablePanel` en
    `OverlayView.tsx`, posición normalizada persistida vía
    `settings_set_overlay_panel_position` nuevo en `settings.rs`/
    `lib.rs`, mismo patrón que `AbilityBarCalibration`). **No verificado
    en partida real** — el primer intento de arrastre no movió el panel;
    se corrigió el motivo obvio (el mismo problema de click-through que
    ya resuelve `Interactive` para el botón "Importar build": un
    `onMouseDown` solo no llega a dispararse sobre una ventana
    click-through, hace falta `onMouseEnter` primero para desactivarlo)
    pero un segundo intento en partida real **tampoco movió el panel**.
    **Pendiente real, con pista real**: esto probablemente comparte causa
    con el bug ya reportado por Julio de que "no se importan las builds
    y runas al seleccionar un campeón" — ambos dependen del mismo
    mecanismo de `setInteractive`/`set_ignore_cursor_events` dejando de
    ser click-through a tiempo. Necesita DevTools reales (activar la
    feature `devtools` de Tauri temporalmente) para ver qué pasa de
    verdad en vez de seguir probando a ciegas con clics sintéticos.
  - `cargo check`, `cargo test`, `npm run typecheck` limpios.

- **Resumen post-partida (2026-08-29)**: Julio: "al acabar una partida
  pondrá el resumen de esta hasta que empiece la siguiente o se cambie de
  ventana". No es una pantalla nueva — reutiliza la misma llamada
  `openProfile` que ya usaba el auto-centrado al conectar (`MainView.tsx`),
  activada ahora también por un segundo listener de `onPhase` que detecta
  el flanco de salida de `"InProgress"` (partida recién terminada) y
  navega al perfil propio si el usuario está inactivo en Herramientas
  (mismo guard que el auto-centrado de conexión). Al ser el mismo
  `ProfileScreen`, el historial de partidas recién refrescado trae la
  partida que acaba de terminar arriba del todo — no hace falta un
  endpoint ni un tipo de dato nuevo. Sale solo en cuanto el usuario
  navega a cualquier otra pantalla ("se cambie de ventana"); vuelve a
  poder dispararse en la siguiente partida porque está anclado al flanco
  de fase, no a una bandera de "ya mostrado". Sin cambios en Rust — 
  `onPhase` ya estaba expuesto de punta a punta sin usar desde
  `MainView`. `npm run typecheck` limpio. **Pendiente real**: solo
  verificable por Julio terminando una partida real (bloqueado hoy por
  no poder crear una personalizada vía LCU, ver "Pendiente").
- **Paridad perfil detectado = perfil buscado, reconfirmada (2026-08-29)**:
  Julio insistió en que no le convencía cómo se veía el perfil
  autodetectado. Verificado en la build real (`target/debug`, PID vivo)
  con capturas lado a lado: `LocustReChikito#EUW` (autodetectado, vía el
  chip de Herramientas) y `Locust#LCT` (buscado, vía perfiles guardados)
  renderizan la misma estructura, mismas cards de cristal, mismo radar,
  mismo calendario — pixel-consistentes salvo por los datos propios de
  cada cuenta. Es el mismo componente (`ProfileScreen` vía `openProfile`)
  para ambos casos desde el trabajo de paridad del 2026-08-28, así que no
  había nada que arreglar en el código; la sospecha de un corte diagonal
  dorado en la esquina de las cards (visto en una captura muy comprimida)
  resultó ser el borde superior de color por tier (`RankCard`,
  `borderTop` según `lpTierColor`) recortado normalmente por el
  `border-radius` — comportamiento correcto, no un bug.
- **Perfil con el mismo look de la web (2026-08-28)**: hasta ahora
  `ProfileScreen.tsx` (búsqueda, comparación y el perfil propio
  auto-detectado al abrir League, mismo componente para los tres) tenía
  estilo propio deliberadamente distinto al de la web. Julio: "quiero
  que... muestre los datos tal y como se ven en la web, no hay necesidad
  de ese otro estilo diferente" — revierte esa decisión de 2026-08-25
  (documentada en el propio `route.ts` de la web, actualizada también).
  Cards de cristal iguales a las de la web (mismo `cardStyle`, un único
  sitio), radar SVG a mano en vez de barras (mismos datos que ya
  calculaba `profile-analysis.ts`, solo cambió la visualización), y tres
  secciones nuevas que antes no existían: tendencia de LP, calendario de
  actividad y pool de campeones (con maestría real vía
  `getChampionMasteries`, extendido en el endpoint público
  `/api/v1/profile/[platform]/[riotId]` de la web — mismo patrón de tipos
  duplicados que ya usa `profile-types.ts`). Verificado en real con
  `npm run dev` + Chrome contra `Locust#LCT`: las tres secciones nuevas
  cargan con datos reales, comparado visualmente contra
  `riftcompass.com/profile/euw1/Locust-LCT`.
  **Pendiente conocido, fuera de alcance a propósito**: el calendario
  solo muestra el mes actual con las ~14 partidas que ya trae el payload
  — navegar a meses anteriores (como sí permite la web) necesitaría una
  llamada nueva a Riot (rango de partidas + detalle de cada una) que la
  app de escritorio no hace hoy.
- **Chip del jugador detectado en Herramientas (2026-08-28)**: Julio
  quería, junto al título "Herramientas", el icono+nombre real del
  jugador que la app detectó al abrir League, clicable para volver a su
  perfil auto-abierto sin tener que buscarlo nuevamente después de
  navegar a una herramienta. `profileIconId` no venía en `LcuIdentity` —
  ya se pedía igualmente en `get_local_identity` (`game_connection.rs`,
  la misma llamada a `/lol-summoner/v1/current-summoner` de siempre) así
  que solo hacía falta reenviarlo, no una llamada nueva. `cargo check`,
  `npm run typecheck` y `npm run build` limpios. **Solo verificable por
  Julio con League realmente abierto** — en modo navegador
  (`npm run dev`) no hay LCU, así que el chip nunca aparece ahí por
  diseño, no es un bug.
- **Frontend completo**: las 11 herramientas, i18n (en/es/fr/de), perfiles
  (búsqueda, comparación, guardados con carpetas), ajustes. `tsc` y
  `vite build` limpios.
- **Cuentas**: login contra riftcompass.com, sesión cifrada (DPAPI) que
  sobrevive reinicios y se revalida contra `/api/v1/me`; perfiles
  guardados, carpetas, tier lists, drafts y mapas sincronizados con el
  mismo backend que usa la web (regla del `CLAUDE.md` raíz: todo lo
  guardable va vinculado a la cuenta). Verificado con cuenta real.
- **Ciclo de vida**: arranque con Windows en segundo plano (activado por
  defecto, desactivable en Ajustes de forma persistente), la ventana se
  abre sola al detectar el cliente de League (~1s con lockfile presente),
  la X la devuelve al tray, y solo el Quit del tray cierra el proceso.
  Verificado de punta a punta con el cliente real (cerrar LoL, relanzar
  desde Riot Client, reconexión y reapertura automáticas).
- **Backend LCU completo**: lockfile + REST + WebSocket de eventos, fase
  de juego, identidad y auto-centrado del perfil propio, Live Client Data
  en partida, import de builds. `cargo check` y `cargo test` limpios.
- **Auditoría de rendimiento (2026-08-27)**: revisado a fondo por si el
  proceso en segundo plano podía costarle FPS a un jugador con la
  partida abierta. Conclusión: la arquitectura ya era la correcta —
  todo lo que no es polling de bajo coste (lockfile cada 2.5s solo
  mientras no hay cliente conectado, Live Client Data cada 3s solo
  durante una partida) es puramente por eventos vía el WebSocket del
  LCU, no hay ningún `setInterval`/`requestAnimationFrame` en el
  frontend, y la ventana principal no recibe eventos de partida en vivo
  (solo `OverlayView.tsx`, hoy desactivada, los consume) — así que hoy
  no hay ningún re-render de fondo mientras la app está en el tray. Sí
  faltaba tuning real: `src-tauri/Cargo.toml` no tenía
  `[profile.release]` (el release de Rust por defecto prioriza
  velocidad de compilación, no de ejecución) — añadido `lto = true`,
  `codegen-units = 1`, `panic = "abort"`, `strip = true`. Pendiente real
  para cuando se reactive la overlay: medir en partida real que su
  render cada 3s no cueste composición de más.

## Pendiente

1. **Revisión herramienta a herramienta — completa 2026-08-28** (diseño
   y concepto). Regla de paridad en el `CLAUDE.md` raíz: cada cambio se
   aplica a la vez en RiftCompass-Tauri y RiftCompass-Web. Las 11
   herramientas ya pasaron por esta ronda. Las 3 últimas (Tier List
   Builder, Personality Test, Cooldown Comparator) ya nacían sólidas
   (ver fork del 2026-08-28: sin drift de paridad real que arreglar),
   así que la mejora fue enriquecerlas con datos reales del crawler que
   ya existían un archivo al lado y no se usaban: badge de tier/winrate
   real junto a cada campeón en las dos primeras (de paso se encontró y
   arregló un bug real en la web: Personality Test usaba el parche
   actual sin fallback, así que no mostraba nada mientras el parche más
   nuevo no tuviera muestra propia). **Cooldown Comparator también
   tuvo una línea de tiempo de intercambio (slider de segundos
   transcurridos), pero se revirtió el mismo día** — Julio: "es irreal
   pues no sabes que se ha subido el otro" (asume rangos de habilidad
   del rival que en una partida real no se pueden saber) y no es algo
   que hagan las apps de overlay reales (iTero/Blitz/Porofessor). Se
   queda tal y como estaba (rank pips + haste + cooldown estático).
2. **Overlay in-game**: reactivada 2026-08-28 (`ENABLE_OVERLAY = true` en
   `lib.rs`) para la ronda de revisión en partida real de Julio, que la
   prueba en personalizadas para poder atender al desarrollo en vez de a
   la partida en sí. Módulos ya construidos siguiendo el orden accionable
   de `docs/overlay-research.md`: CS/min y oro (ya existían), timers de
   dragón/heraldo/barón (exactos, vía el array `Events` de Live Client
   Data — el heraldo no reaparece tras morir, a diferencia de dragón/
   barón), y cooldown de hechizos de invocador por marcado manual +
   cooldown base de Data Dragon (siempre estimado, sin API oficial para
   verlo en un rival). Todo son constantes de temporada fáciles de
   revisar (`OverlayView.tsx`, primeras líneas), no valores clavados en
   el JSX. **Pendiente real, solo verificable por Julio en partida**:
   carga de la vista (`?view=overlay`), posición, click-through, el
   atajo Ctrl+Alt+R, y que los timers/countdowns midan bien contra el
   reloj real del juego. Descartado a propósito (ver el propio
   `docs/overlay-research.md`): timers de camps individuales de jungla y
   cooldown de ulti ajena, ninguno tiene API oficial viable sin saltarse
   Vanguard.
   - **No se ve sobre el juego en fullscreen exclusivo (2026-08-28,
     diagnosticado; confirmado y arreglado en real 2026-08-29)**: Julio
     reportó no ver nada de lo construido al jugar. Causa real: League en
     modo "Pantalla completa" (fullscreen exclusivo) salta por completo
     el compositor de Windows, así que ninguna ventana externa puede
     dibujarse encima — mismo límite que sufren Porofessor/Blitz/OP.GG,
     no algo arreglable sin hookear el pipeline de render del propio
     juego (lo cual dispararía Vanguard). **Verificado de punta a punta
     en la partida real de Julio (2026-08-29)**: `WindowMode=0` en
     `Config/game.cfg` (el propio ajuste de vídeo del juego) → el overlay
     no dibuja nada encima aunque la ventana esté activa y en primer
     plano; cambiado a `WindowMode=1` (Sin bordes) → el overlay se ve
     perfectamente, confirmado con capturas reales de la partida
     (objetivos, partida en vivo). No era un bug de la app — era
     literalmente el ajuste de vídeo del juego. Añadido `overlay_get_window_mode`
     (`lcu.rs`, lee `WindowMode=` de `Config/game.cfg`, mismo directorio
     de instalación que el lockfile) para que esto no vuelva a
     diagnosticarse a ciegas.
     **Corregido automáticamente, no solo avisado (2026-08-29)**: Julio,
     tras el primer arreglo manual: "quiero que cualquier persona que
     descargue la app no tenga problema en ver el overlay sin necesidad
     de cambiar ningún ajuste". `write_window_mode` (`lcu.rs`) escribe
     `WindowMode=1` directamente en `game.cfg` — un reemplazo puntual de
     solo los dígitos tras `WindowMode=`, no una reescritura línea a
     línea, así que ningún otro ajuste ni el estilo de fin de línea del
     archivo se toca. Se llama una vez al entrar en selección de campeón
     (`MainView.tsx`, antes de que exista el proceso del juego, así que
     nunca compite con él por el archivo) y muestra un banner descartable
     explicando qué cambió — vive en la ventana principal, no en la
     overlay, porque si la overlay es justo lo que no se ve, avisar ahí
     sería inútil. Si la escritura fallara (League no encontrado,
     permisos), cae al aviso manual original en vez de fallar en
     silencio. Verificado en real con una partida personalizada: con
     `WindowMode=0` al entrar en selección de campeón, la app lo cambió
     sola a `1` y mostró el banner de confirmación, sin que Julio (ni
     nadie que instale la app) tenga que tocar los ajustes de vídeo de
     League por su cuenta. `cargo check`, `npm run typecheck` limpios.
   - **Cuatro módulos nuevos añadidos 2026-08-28** (todos apagables por
     separado en Ajustes → overlay, pedido explícito de Julio):
     - **Oro solo con Tab mantenido** (como iTero/Porofessor, ya no
       permanente): `src-tauri/src/tab_watch.rs`, poll de
       `GetAsyncKeyState(VK_TAB)` cada 50ms mientras hay partida en
       curso — lee estado global de teclado, no toca el proceso de
       League, no es nada que Vanguard detecte. Evento
       `overlay:tab-held`.
     - **Sugerencia de qué habilidad subir** por nivel actual, desde
       `/api/v1/champion-skill-order` (RiftCompass-Web, ver su propio
       `CLAUDE.md` — nueva tabla `champion_skill_order_stats` agregada
       vía Timeline de Match-V5, winrate real por nivel).
     - **Build de objetos recomendada** durante la selección de
       campeón, condicionada a tu campeón+rol y a tu **rival de
       carril real** (no al equipo de 10 completo — inviable sin datos
       de matchup que no existen, ver el `CLAUDE.md` de la web) desde
       `/api/v1/champion-build`. Solo referencia visual (iconos), nunca
       autocompra — no existe endpoint LCU para comprar objetos.
     - **Runas y hechizos recomendados aplicados automáticamente**: el
       mismo endpoint `/api/v1/champion-build` alimenta un botón
       "Aplicar build recomendada" que reutiliza
       `build_import.rs::apply_rune_page`/`apply_summoner_spells`
       (antes solo usadas para reimportar tu propia última partida).
       El lado del Flash (izquierda/derecha) es un ajuste nuevo
       (`flashSide`) que decide dónde va Flash dentro del par
       recomendado — la agregación en sí es agnóstica al orden.
     - Todas las recomendaciones muestran su tamaño de muestra real en
       la UI (sin suelo mínimo de partidas, pedido explícito de Julio:
       "quiero ver ya si funciona aunque la muestra no sea lo
       suficientemente grande") y caen honestamente al agregado sin
       rival cuando el matchup específico aún no tiene datos.
     - `cargo check`, `cargo test`, `npm run typecheck` y `npm run
       build` limpios. **Pendiente real, solo verificable por Julio en
       partida**: que el gating por Tab funcione, que la sugerencia de
       habilidad avance con el nivel real, y que el botón de build
       aplique runas+hechizos correctos.
   - **Segunda ronda tras la primera prueba real de Julio (2026-08-28)**:
     reportó que el overlay seguía sin verse sobre el juego (pero sí al
     minimizar — confirma que la ventana renderiza bien, solo pierde la
     carrera de z-order con el tiempo, ver `docs/overlay-research.md`), y
     pidió: objetivos con icono real + CD a la derecha, CS/min según tu
     elo debajo, tabla de oro por carril arriba-izquierda (solo con Tab),
     y un resaltado rosa sobre el icono real de la habilidad recomendada
     en el HUD del propio juego. Todo investigado y construido esa misma
     sesión:
     - `overlay_topmost.rs` (nuevo): reafirma `set_always_on_top(true)`
       cada 1.5s en vez de fiarse del flag de creación — arranca/para
       junto a `show_overlay`, mismo ciclo de vida que `tab_watch.rs`.
     - La ventana del overlay pasó de 420×700 en la esquina superior
       derecha a cubrir el monitor entero (`create_overlay_window` en
       `lib.rs`) — necesario para tener a la vez la tabla de oro
       arriba-izquierda, los objetivos arriba-derecha, y el resaltado de
       habilidad en cualquier punto de la pantalla (donde esté calibrada
       la barra real).
     - Objetivos: iconos reales verificados con `curl` contra Community
       Dragon (dragón/heraldo/barón — sin icono confirmado para las
       larvas del vacío, se queda en texto, no se inventa una URL) +
       cooldown encima, más la constante de heraldo corregida
       (`HERALD_SPAWN_SECONDS` estaba en 8:00, de antes de que existieran
       las larvas — ahora 15:00) y las larvas añadidas como timer nuevo.
     - CS/min según el elo real del jugador (LCU
       `/lol-ranked-stats/v1/current-ranked-stats`, nunca pedido antes en
       el overlay) contra los mismos objetivos por rango que ya usa el
       roadmap del perfil (`CS_PER_MIN_TARGETS`/`tierToBand`, reutilizados
       de `profile-analysis.ts`).
     - Tabla de oro por carril (top/jungla/mid/bot/support, tu equipo
       siempre a la izquierda) sustituye la diferencia de oro que antes
       vivía dentro de la lista de jugadores por equipo — emparejado vía
       `assignedPosition` de champ select + `championId → internalId`,
       igual que ya se resolvía para la build recomendada.
     - Calibración de la barra de habilidades: como Live Client Data no
       expone coordenadas de pantalla ni escala de HUD (investigado, ver
       `docs/overlay-research.md`), es una calibración manual de un solo
       click por habilidad (Q, W, E) desde Ajustes → "Calibrar barra de
       habilidades" (`overlay_enter_calibration`/`exit_calibration` en
       `lib.rs`, guardado en `settings.rs::AbilityBarCalibration` como
       fracción normalizada de pantalla, nunca una posición inventada).
       Sin calibrar, el resaltado simplemente no se dibuja.
     - `cargo check`, `cargo test`, `npm run typecheck` y `npm run build`
       limpios. **Pendiente real, solo verificable por Julio en
       partida**: que el overlay ya se mantenga encima del juego de
       verdad, la calibración de la barra de habilidades, la tabla de oro
       por carril, y los nuevos timers de heraldo/larvas contra el reloj
       real del juego.
   - **Pendiente aparte, anotado por Julio, sin cambio de código
     necesario todavía**: si la app sigue abierta y se cierra y reabre
     League (p. ej. para cambiar de cuenta), debe detectarlo igual que la
     primera vez — el bucle de reconexión de `game_connection.rs::run` ya
     vuelve a esperar el lockfile y re-emite identidad tras cualquier
     desconexión, así que debería cubrir este caso por construcción; se
     deja marcado para que Julio lo confirme explícitamente en vez de
     darlo por hecho.
   - **Sugerencias de pick con winrate real, no solo hueco de
     composición (2026-08-29)**: Julio pidió que la selección de campeón
     recomendara "según qué está más fuerte y lo que eligen los
     rivales", comparando explícitamente con iTero. Probado iTero en
     vivo con una partida personalizada real (bots en el equipo
     contrario): su sugerencia de pick es una lista de iconos por rol sin
     ningún porcentaje visible, y su importación de build/runas tampoco
     es automática — exige el mismo botón manual ("Importar última
     build") que ya tiene esta app, así que en eso RiftCompass ya iguala
     la referencia. El hueco real era la sugerencia de pick en sí:
     `suggestPicks` (`draft-help.ts`) recomendaba por "clase de Data
     Dragon que le falta a tu equipo + menor dificultad", nunca por
     winrate. Reescrito para priorizar el winrate real del crawler
     (`/api/v1/champion-winrates`, mismo dato que Meta Tier List, sin
     filtro de rango — mismo criterio de "un número honesto general" que
     ya usa Champion Pool Builder) y caer al heurístico de hueco de
     composición solo para rellenar huecos si el crawler aún no tiene
     muestra suficiente para ese rol. La API de Riot no expone winrate
     real por matchup 1v1 (mismo bloqueo estructural que el "counter del
     counter" ya descartado en el `CLAUDE.md` de la web), así que en vez
     de inventar un número de counter se muestra el rival de carril real
     una vez revelado (dato honesto que ya se tenía) para que el jugador
     reaccione con su propio criterio. Verificado en vivo con una partida
     personalizada real: la sugerencia para Top mostró Cho'Gath 65%
     (52 partidas), Garen 61% (111), Yasuo 60% (67) — datos reales del
     crawler, no una lista sin números. `cargo check`, `npm run
     typecheck` limpios.
3. **Instalador — generado 2026-08-28**: `npx tauri build` completo (sin
   `--no-bundle`) produce los dos bundles sin configuración adicional
   (`bundle.active`/`targets: "all"` en `tauri.conf.json` ya estaban
   listos, solo faltaba ejecutarlo): `src-tauri/target/release/bundle/
   msi/RiftCompass_0.1.0_x64_en-US.msi` y `.../nsis/
   RiftCompass_0.1.0_x64-setup.exe`. **No instalado ni probado
   todavía** — instalar desde uno de los dos deja una copia en Program
   Files/Menú Inicio con su propio desinstalador, **independiente** del
   exe+acceso directo manual actual (`target/release/riftcompass.exe`,
   el que ya usa el acceso directo del escritorio) — decidir si el
   acceso directo pasa a apuntar a la copia instalada o si conviven
   ambas mientras se sigue en desarrollo.
4. **Limpieza de carpetas — completa, verificado 2026-08-30**:
   `RiftCompass-Overlay/` (Electron, ya reemplazada) ya no está en
   `Desktop\Proyectos\RiftCompass\` — borrada.
5. **Cuenta**: la eliminación de cuenta es manual por correo (ver
   política de privacidad); valorar autoservicio en la web.
6. **Clave de la API de Riot — resuelto 2026-08-27**: Personal API Key
   permanente obtenida (App 875077, aprobada al instante) y en uso en
   Vercel + `.env.local`, verificado en real. Ya no caduca cada 24h, no
   hay ciclo de renovación que mantener.
7. **El overlay entero es click-through incluso tras `setInteractive(true)`
   — bug real, más grande de lo que parecía (investigado a fondo
   2026-08-30, sin resolver)**: `useDraggablePanel` (`OverlayView.tsx`)
   usa el mismo patrón que `Interactive` (onMouseEnter desactiva
   click-through antes del clic), pero el arrastre no funciona en
   partida real. Investigado con DevTools reales (activados vía la
   feature `devtools` de Tauri +  atajo global temporal Ctrl+Alt+D en
   `lib.rs`, ya que un clic normal nunca llega a una ventana
   click-through para abrir "Inspeccionar"):
   - **Confirmado por descarte**: la lógica JS pura del arrastre es
     correcta — probada en un `npm run dev` normal (`?view=overlay&
     debugDrag=1`, mock temporal en `OverlayView.tsx` que fuerza
     `tabHeld`/`liveGame` sin backend) con DevTools de un navegador
     normal: clicar y arrastrar el panel funciona perfecto ahí, porque
     un navegador normal no tiene concepto de click-through.
   - **Confirmado en partida real**: un intento de arrastrar el panel de
     objetivos con el clic empezando sobre el propio panel visible
     terminó moviendo la ventana del cliente de League que había debajo
     — prueba directa de que el clic atraviesa el overlay sin que
     `onMouseEnter`/`setInteractive(true)` lo hayan desactivado a
     tiempo, o de que `onMouseEnter` no llega a dispararse en absoluto
     sobre una ventana click-through de Tauri/WebView2.
   - **Corrección importante de una suposición previa**: se asumía que
     este mecanismo (`Interactive`, usado por el botón "Importar build"
     desde 2026-08-27) ya estaba probado y funcionando — releyendo el
     propio historial, en realidad **nunca se verificó en partida real**
     ("Pendiente real, solo verificable por Julio en partida: ... que el
     botón de build aplique runas+hechizos correctos"), y el reporte de
     Julio de esta misma sesión ("no se importan las builds y runas al
     seleccionar un campeón") confirma que tampoco funciona. Es decir:
     **el bug no es nuevo de esta sesión ni exclusivo del arrastre** —
     el mecanismo entero de click-through-bajo-demanda del overlay
     probablemente no ha funcionado nunca desde que existe.
   - **Pendiente real, con DevTools ya dejados activos a propósito**: no
     se pudo llegar a leer la consola en directo durante un arrastre
     real (el intento vía `SendKeys`/`AppActivate` para escribir en la
     consola del DevTools no funcionó, y la partida de prueba se
     desconectó por inactividad antes de poder reintentarlo). Próximos
     pasos concretos para la siguiente sesión: (a) con DevTools ya
     abierto (Ctrl+Alt+D) y una partida real en marcha, comprobar si
     `onMouseEnter` llega a dispararse en absoluto (breakpoint o
     `console.log` temporal en `useDraggablePanel`/`Interactive`); (b) si
     sí dispara, comprobar si el invoke a `overlay_set_interactive`
     realmente completa antes de que el usuario haga clic (posible
     condición de carrera); (c) revisar si `overlay_topmost.rs` (reafirma
     `set_always_on_top(true)` cada 1.5s) interfiere de algún modo con
     `set_ignore_cursor_events` pese a que en teoría son banderas
     independientes de la ventana.
   - **Dejado activo a propósito para la próxima sesión**: la feature
     `devtools` en `Cargo.toml` y el atajo global Ctrl+Alt+D (ambos
     comentados como TEMPORARY en el código) — quitarlos junto con el
     mock `?debugDrag=1` de `OverlayView.tsx` en cuanto el bug esté
     resuelto.
8. **Migración a Electron + Overwolf para overlay sobre pantalla completa
   exclusiva — decidida, no iniciada (2026-08-30)**: investigado a fondo
   por qué el overlay no puede verse sobre Fullscreen exclusivo real
   dentro de Tauri (DWM no compone nada mientras el juego tiene
   exclusividad — mismo límite que sufren Porofessor/Blitz, confirmado
   contra la documentación de Discord/OBS/Steam). La única vía real, la
   que usa iTero, es el motor de overlay de Overwolf (hookea
   `Present`/`EndScene` dentro del proceso del juego) — pero solo se
   puede integrar en una app construida sobre `ow-electron` (un fork de
   Electron), no como librería añadida a Rust/Tauri. Julio decidió
   migrar la app entera a Electron para conseguirlo, manteniendo el
   aspecto visual actual intacto. Catalogado en detalle qué hay que
   portar (todo el backend `src-tauri/src/*.rs` → proceso principal de
   Node; el frontend `src/` se reutiliza casi sin cambios, solo
   `src/bridge/index.ts` y `src/WindowControls.tsx` tocan la API de
   Tauri directamente). **Bloqueante externo**: el acceso a los paquetes
   `@overwolf/ow-electron*` exige que Overwolf apruebe la idea de la app
   antes — paso que solo Julio puede iniciar (cuenta de desarrollador
   propia), tiempo de espera desconocido. Proyecto grande, de varias
   sesiones, aparte de todo lo demás.
   **Formulario de propuesta enviado — 2026-08-30**: Julio creó la cuenta
   (login Google) y Claude rellenó y envió el formulario real en
   dev.overwolf.com/app-idea-form con su autorización. Confirmación
   "Proposal Sent" recibida; cuenta en estado "Pending" a la espera de
   respuesta por email. Detalle completo de lo enviado y un hallazgo
   importante (Overwolf no aprueba apps "privadas" en su terminología —
   RiftCompass se planteó como app pública para evitarlo) en
   `docs/overwolf-registration.md`. **Pendiente real**: esperar la
   respuesta de Overwolf; en cuanto llegue el acceso, retomar la Fase 2
   (desarrollo) — catálogo de qué portar ya hecho, ver el propio
   `docs/overwolf-registration.md`.
   **Instrucción de Julio (2026-08-30)**: en cuanto la migración a
   Electron esté terminada y verificada, borrar `RiftCompass-Tauri/` por
   completo — no debe quedar como versión paralela.
9. **Rediseño de objetivos + nuevos paneles CS/min y hechizos rivales
   (2026-08-30)**: iconos propios dibujados a mano en
   `src/lib/objective-icons.tsx` (SVG inline, sin depender de Community
   Dragon) para los 4 objetivos neutrales — antes larvas no tenía icono
   real (Community Dragon no lo tiene) y caía a texto. Como larvas,
   heraldo y barón nacen en el mismo pozo del mapa, `computePitTimer` los
   fusiona en una sola entrada que va cambiando (larvas → heraldo → barón)
   en vez de tres timers en paralelo; dragón mantiene su propia entrada.
   La tarjeta de objetivos ahora solo muestra icono + tiempo restante
   debajo, sin cabecera ni texto adicional (petición explícita de Julio).
   CS/min salió de la tarjeta de objetivos a su propia tarjeta arrastrable
   (debajo por defecto). Nueva tarjeta "Hechizos rivales"
   (`enemySpells`, esquina inferior derecha por defecto): un icono por
   campeón rival + sus 2 hechizos de invocador (vía Live Client Data,
   `allPlayers[].summonerSpells`), clicables — al pulsar uno arranca una
   cuenta atrás manual (cooldown base sin reducciones de CDR, tabla
   `SUMMONER_SPELL_INFO`) que se actualiza cada segundo, para saber cuándo
   vuelve a estar disponible. Las 4 tarjetas comparten el mismo mecanismo
   de arrastre (`useDraggablePanel`) y persistencia de posición
   (`OverlayPanelPositions` en Rust/TS ampliado con `csPerMin` y
   `enemySpells`).
   **Verificado visualmente** (no en partida real — ver el bug de
   click-through pendiente en el punto 7 de arriba): `npm run dev` +
   `?view=overlay&debugDrag=1` con un mock 5v5 completo (roster, Live
   Client Data, hechizos rivales) — capturas confirmaron los 4 iconos, el
   timer de larvas mostrando "¡Arriba!" correctamente a los 10:20 de
   partida (antes de que despawnee a los 14:45), la tabla de oro por
   carril con las 5 filas y sus diferencias reales (+850g, +200g, +100g,
   ~0g, ~-100g), y el clic en Flash arrancando la cuenta atrás (297 → 278
   segundos entre dos capturas, ticking real).
   **Sobre "sigo sin ver el número de oro" (reporte de Julio)**: releyendo
   `resolveLanePlayer`/`buildLaneRows` de nuevo, y con la tabla de oro
   funcionando correctamente en el mock de arriba (con ambos lados
   resueltos), el código en sí está bien — la diferencia solo puede
   faltar (mostrar "—") cuando `assignedPosition` no está informado en
   uno de los dos equipos, y eso solo pasa de verdad en una partida
   personalizada donde no se ha asignado manualmente el carril de cada
   jugador/bot con el desplegable de rol antes de empezar (en cola
   normal/ranked el cliente asigna rol a las 10 posiciones automáticamente
   y por eso ahí no debería faltar). La prueba en vivo de la sesión
   anterior confirmó exactamente este caso (bot rival sin rol asignado).
   **Pendiente real de confirmar por Julio**: si su próxima prueba fue una
   personalizada sin asignar rol a ambos equipos, o una partida
   emparejada de verdad — si es lo segundo y el número sigue sin salir,
   es un bug nuevo que hay que investigar con datos reales (logging
   temporal), no una suposición.
   Gates verdes: `npm run typecheck`, `cargo check`, `npx tauri build
   --no-bundle` (exe release regenerado y relanzado en segundo plano).
10. **Retoques de pulido tras feedback directo de Julio (2026-08-30)**:
    - Oro por carril: quitado el prefijo "~" y la "g" del número de
      diferencia (`+850` en vez de `+~850g`) — se entiende sin marcarlo,
      y el campo `exact` de `goldForPlayer` se eliminó al quedar sin uso.
    - **Iconos de objetivos revertidos**: a Julio no le gustaron los SVG
      dibujados a mano de la entrada anterior — se han borrado
      (`src/lib/objective-icons.tsx` eliminado) y sustituido por iconos
      reales de Riot: el atlas de iconos del minimapa de Community Dragon
      (`raw.communitydragon.org/.../ux/minimap/icons/`), que sí tiene un
      icono real de larvas (`grub.png`, se creía que no existía ninguno —
      solo faltaba en el atlas de scoreboard usado antes, no en el de
      minimapa) además de dragón/heraldo/barón, los cuatro con la misma
      estética (el propio set de iconos del cliente).
    - CS/min: quitado el texto "CS/min (tu rango)", sustituido por el
      emblema real de la elo del jugador (`rankEmblemUrl`, mismo asset
      que ya usa el perfil web) a la izquierda del número; sin rango
      (unranked/aún no cargado) se deja el hueco vacío en vez de
      inventar un icono.
    - Hechizos rivales: tarjeta más compacta (padding y gaps reducidos,
      iconos de campeón 24→20px y de hechizo 22→18px, ancho ahora
      automático en vez de fijo a 210px) — eliminado el espacio sobrante
      que sobraba con solo 2 hechizos por fila.
    Verificado visualmente en `npm run dev` + `?view=overlay&debugDrag=1`
    (capturas): números de oro sin "~g", iconos de objetivos reales
    cargando bien (no rotos), panel de hechizos visiblemente más
    compacto. Typecheck limpio, `npx tauri build --no-bundle` regenerado
    y relanzado.
11. **Dos correcciones más de Julio sobre lo anterior (2026-08-30)**:
    - Oro por carril: añadidas líneas horizontales divisorias entre cada
      carril (`borderTop` en cada fila salvo la primera, en vez de solo
      `gap`).
    - Objetivos: Julio reportó que "el cuadrado que los envuelve no está
      correctamente al rededor, su borde derecho corta uno de los
      iconos" — el ancho fijo (112px) del `cardStyle` quedaba justo y
      recortaba el segundo icono. Antes de arreglar el ancho, Julio
      aclaró que directamente no quiere la tarjeta de fondo ahí: ahora
      los dos iconos + su tiempo van sueltos sobre el juego, sin caja ni
      borde, con `filter: drop-shadow(...)` para que se lean sobre
      cualquier fondo (antes dependían del contraste de la tarjeta
      oscura). Se mantiene arrastrable igual que el resto de paneles.
      Confirmado que los iconos en sí (Community Dragon, atlas de
      minimapa) son reales y correctos — comparados los 4 lado a lado a
      96px en una página de prueba antes de descartar esa hipótesis.
    Typecheck limpio, `npx tauri build --no-bundle` regenerado y
    relanzado.
12. **Confirmación + un ajuste más (2026-08-30)**: Julio preguntó si los
    dos iconos de objetivos se arrastran como uno solo — sí, ya lo eran
    (ambos son hijos del mismo `<div>` con los manejadores de arrastre,
    ninguno tiene su propio `onMouseDown`), confirmado arrastrándolos en
    el mock del navegador. El panel de oro por carril tenía un ancho fijo
    (`width: 360`) que dejaba mucho hueco muerto a los lados de cada
    icono — cambiado a `width: "auto"` (mismo criterio que ya se usó en
    "Hechizos rivales"), con lo que el grid de 3 columnas se ajusta al
    contenido real en vez de estirarse. Typecheck limpio, exe
    regenerado y relanzado.
13. **Migración a Electron — arrancada de verdad, no solo planeada
    (2026-08-30)**: `RiftCompass-Electron/` creada como proyecto hermano
    (esta carpeta, `RiftCompass-Tauri/`, sigue intacta y es la app que
    usa Julio hasta que la nueva esté verificada). Portado todo el
    backend Rust a Node/Electron (`electron/*.ts`, cada fichero con
    comentario señalando de qué `.rs` viene 1:1) y el frontend `src/`
    casi sin cambios (solo `bridge/index.ts` y `WindowControls.tsx`, que
    ya tocaban la API nativa directamente). Detalle completo de
    arquitectura y decisiones en `RiftCompass-Electron/CLAUDE.md`.
    **Bloqueante nuevo descubierto**: Overwolf respondió al registro de
    la sesión anterior exigiendo que Riot Games apruebe la app también
    (portal de desarrolladores propio de Riot) antes de dar acceso a
    `@overwolf/ow-electron*` — ver `docs/overwolf-registration.md`,
    sección actualizada. Ese paso solo puede iniciarlo Julio.
    **Bug real encontrado y arreglado verificando en vivo**: Electron
    20+ sandboxa los scripts de preload por defecto, lo que bloqueaba en
    silencio todo `window.riftcompass` (preload no podía hacer `require`
    de su propio módulo local `./windows`) — cada llamada del bridge caía
    al stub local sin ningún error visible más que un "no se pudo
    contactar con riftcompass.com" genérico y engañoso. Arreglado con
    `sandbox: false` en `webPreferences` de ambas ventanas (documentado
    en `RiftCompass-Electron/CLAUDE.md`'s gotchas).
    **Verificado visualmente en vivo** (Julio navegando la app él mismo
    mientras se depuraba): ventana principal sin decoraciones con sus
    controles propios funcionando, Ajustes, Mi Tier List con drag-and-
    drop y los iconos reales de campeón, i18n, todo con el mismo aspecto
    exacto que la versión Tauri.
    **Verificación end-to-end contra el LCU real — hecha y confirmada
    (2026-08-31)**: Claude abrió League de verdad (Riot Client → Play) y
    la app Electron detectó la conexión sola ("Cliente de League
    conectado", punto verde) y se auto-mostró (mismo comportamiento
    iTero que la versión Tauri). La página de perfil cargó datos reales
    de la cuenta conectada (LocustReChikito#EUW: tendencia de rango,
    resumen de habilidades, calendario de actividad, campeones jugados
    con winrate/KDA/CS real) y la sesión de riftcompass.com sobrevivió al
    reinicio de la app (login persistido y validado contra `/api/v1/me`
    de verdad, perfiles guardados reales en la barra lateral). Único
    bloqueante real que queda es Overwolf/Riot (Paso 4, overlay real en
    pantalla completa exclusiva — ver `docs/overwolf-registration.md`).
    `RiftCompass-Tauri/` no se borra hasta que Julio lo confirme
    explícitamente, aunque la paridad funcional ya está verificada.

## Región / plataforma

`/riotclient/region-locale` es el endpoint verificado en vivo para la
región. En el mapa región→plataforma solo EUW está verificado en real;
el resto son los códigos públicos estables de Riot, y las subregiones SEA
son la apuesta de menos confianza. Región desconocida ⇒ el auto-centrado
no se activa (nunca enrutar a una plataforma equivocada).

## Cierre de esta carpeta (2026-08-31) — migración a Electron completada

Esta es la última entrada de `RiftCompass-Tauri/PROGRESS.md`: la carpeta
se elimina hoy porque `RiftCompass-Electron/` alcanzó paridad real (y en
un punto la supera, ver abajo). Historial completo conservado en
`RiftCompass-Electron/PROGRESS.md` (copia íntegra de este fichero) —
consultar ahí, no aquí, para cualquier sesión futura.

**Hallazgo importante de la última ronda de pruebas en vivo (LCU real,
partidas personalizadas con bots)**: el motivo real, verificado, de que
Julio nunca viera la diferencia de oro entre carriles en sus propias
pruebas — más profundo que los dos bugs ya arreglados antes (evento de
teardown del LCU, casing de `assignedPosition`) — es que **Live Client
Data reporta el nombre de un campeón controlado por bot en el idioma del
propio cliente de League, no en el id interno inglés de Data Dragon**
("Maestro Yi" para MasterYi, "Twisted Fate"/"Xin Zhao" con espacio donde
el id interno no lo tiene, bajo un cliente en español). Este bug SIEMPRE
existió también aquí en `RiftCompass-Tauri` (el código de
`resolveLanePlayer` era idéntico) — nunca se detectó porque nunca se
depuró con logging real hasta la sesión de migración. **Arreglado en
Electron**, no aquí: `ddragon.ts` ahora indexa también por nombre
normalizado en el idioma real del cliente (`mergeLocalizedChampionNames`,
usando el locale real de `/riotclient/region-locale` reenviado por
`gameConnection.ts` en `lcu:identity`), y `resolveLanePlayer`/las tres
búsquedas de icono de campeón usan esa tabla en vez de comparar contra el
id interno en inglés directamente.
**Verificado en real** con 4 partidas personalizadas seguidas: los 5
carriles del propio equipo resuelven correctamente (top/jungla/mid/bot/
support, incluyendo campeones con nombre compuesto). **Pendiente real, no
bloqueante**: en esas mismas pruebas, el equipo rival (con bots en las 5
posiciones) seguía sin resolver — la sesión de champ-select nunca reportó
`championId` real para `theirTeam` en ninguna de las 4 partidas, algo
que parece propio de cómo los bots completan su elección (no pasan por
una acción de "lock" visible como un jugador real) y no algo que
dependa del arreglo de idioma. No se pudo confirmar con un enemigo humano
real esta sesión — si Julio ve el mismo problema en una partida
emparejada de verdad (con humanos reales en el otro equipo), es un bug
nuevo a investigar con logging; si solo pasa contra bots, es una
limitación de las pruebas, no del código real.

## Empaquetado, icono, acceso directo y limpieza final (2026-08-31)

Con la migración funcionalmente completa, esta carpeta pasa a ser la app
real (`RiftCompass-Tauri/` ya no existe, ver el `CLAUDE.md` raíz):

- **Icono propio**: `electron/windows.ts` ahora pasa `icon: build/icons/
  icon.ico` a ambas ventanas (antes salía el icono genérico de Electron
  en dev — Julio, 2026-08-31: "la app no tiene el icono").
- **Empaquetado real**: `electron-builder --dir --win` genera
  `release/win-unpacked/RiftCompass.exe` (build "dir" sin instalador, el
  equivalente al exe suelto que generaba `tauri build`). Hubo que añadir
  `npmRebuild: false` en `electron-builder.yml` — su rebuild automático
  de dependencias nativas intenta invocar `node-gyp` sobre `@primno/
  dpapi`/`koffi` (que ya traen binario prebuilt y no lo necesitan) y
  falla por falta de `node-addon-api`.
- **Acceso directo del escritorio**: `RiftCompass.lnk` actualizado para
  apuntar a `release/win-unpacked/RiftCompass.exe` (antes apuntaba al
  `riftcompass.exe` de Tauri).
- **`RiftCompass-Tauri/` retirada de verdad**: sí tenía repo git propio
  con remoto en GitHub (`github.com/juliolpzsu/RiftCompass-Tauri`) — los
  cambios pendientes de esa sesión (revert de WindowMode, fix de oro,
  rediseño de objetivos) se comprometieron y empujaron a `main` antes de
  borrar la carpeta local, así que el historial completo sigue
  disponible ahí si hace falta consultarlo. La carpeta local se borró
  (solo quedó un directorio vacío con un bloqueo transitorio de Windows
  que no se pudo liberar tras varios intentos — sin contenido real
  dentro, Julio puede borrarlo a mano cuando quiera).
- **Limpieza de código**: quitados todos los `console.log` de diagnóstico
  añadidos para encontrar el bug de idioma (en `windows.ts`,
  `gameConnection.ts`, `tabWatch.ts`, `OverlayView.tsx`) y el mock
  temporal `?debugDrag=1` (ya cumplió su propósito — el overlay está
  verificado en partidas reales, no hace falta simularlo más).
- **Seguridad**: añadida una Content-Security-Policy real en
  `index.html` (antes no había ninguna — Electron lo avisaba en cada
  arranque en dev). Restringe `script-src`/`img-src`/`connect-src`/
  `style-src`/`font-src` a los hosts que la app realmente usa (Data
  Dragon, Community Dragon, riftcompass.com, Google Fonts) — verificado
  que la app sigue cargando bien con ella puesta. `script-src` conserva
  `unsafe-eval` porque el HMR de Vite en dev lo necesita; el build de
  producción no usa `eval`, así que hay margen para cerrarlo más quien
  retome esto. Añadido también `.gitignore` (no existía) y el campo
  `author` en `package.json` (electron-builder avisaba de que faltaba).
- **Verificado**: el exe empaquetado final abre, detecta el cliente de
  League real, y muestra los datos de perfil reales — mismo resultado
  que en dev.

**Pendiente real que queda**: la aprobación de Riot/Overwolf (bloqueante
externo, ver `docs/overwolf-registration.md`) y, cuando llegue, sustituir
`createOverlayWindow` en `electron/windows.ts` por la API real de
Overwolf para que el overlay se vea también en pantalla completa
exclusiva — hasta entonces, paridad exacta con lo que ya había en
Borderless/Windowed.
