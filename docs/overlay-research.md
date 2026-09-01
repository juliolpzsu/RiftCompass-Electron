# Overlay in-game: cómo lo hacen iTero/Blitz/Porofessor/Mobalytics y qué le falta al nuestro

## Añadido 2026-08-28: por qué la ventana perdía el "siempre encima", y los timers de heraldo/larvas

- **`WS_EX_TOPMOST` no es "siempre encima" para siempre**: solo mete la
  ventana en la banda topmost de Windows; dentro de esa banda, quien
  reafirma foreground/topmost más recientemente (el propio motor del
  juego, en cualquier cambio de foco) pasa por delante, aunque nuestro
  flag nunca se quite. Julio lo confirmó en real: "si minimizo el juego sí
  se ve" (la ventana se dibuja bien, solo pierde la carrera de z-order con
  el tiempo). Fuente:
  [Window Features - Win32](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features),
  mismo problema ya reportado contra Tauri:
  [wailsapp/wails#4272](https://github.com/wailsapp/wails/issues/4272).
  Arreglo: reafirmar `set_always_on_top(true)` cada 1.5s
  (`overlay_topmost.rs`) en vez de fiarse del flag de creación — esto NO
  arregla el fullscreen exclusivo (sigue sin poder overlayarse, ver la
  sección de más abajo sobre "qué es legal hacer en 2026"), solo el caso
  borderless/windowed donde sí debería funcionar y no lo hacía.
- **`HERALD_SPAWN_SECONDS = 8*60` estaba mal** — era el valor de antes de
  que existieran las larvas del vacío. Verificado contra la wiki oficial
  vigente y las notas de parche: larvas del vacío spawnan a **8:00**,
  desaparecen a **14:45** (una sola oleada, sin respawn), y el
  **Heraldo aparece en el mismo hueco a las 15:00**. Fuentes:
  [Voidgrub camp - wiki oficial](https://wiki.leagueoflegends.com/en-us/Voidgrub_camp),
  [Patch 14.1 Notes](https://www.leagueoflegends.com/en-us/news/game-updates/patch-14-1-notes/).
- **Posición real de los iconos Q/W/E en el HUD del propio juego**: Live
  Client Data no expone coordenadas de pantalla ni escala de HUD — depende
  solo de la resolución y del slider de "HUD Scale" del cliente, ningún
  dato oficial la da. Confirmado contra la documentación de Overwolf para
  desarrolladores (que si sufren el mismo problema con apps que sí tienen
  acceso a un runtime más rico que el nuestro): no hay forma programática
  de saberlo, la práctica real es una calibración manual una sola vez, no
  una tabla de resoluciones adivinada. Implementado así en
  `OverlayView.tsx`/`settings.rs::AbilityBarCalibration` — el usuario hace
  click una vez en Q, W y E; se guarda como fracción normalizada de
  pantalla (0-1), nunca una posición inventada.

Investigación de referencia para la ronda de revisión de `OverlayView.tsx` /
`ENABLE_OVERLAY` (ver `PROGRESS.md`, pendiente #2). Objetivo: que quien retome
esa tarea no tenga que volver a investigar cómo consiguen estos datos las
apps de la competencia ni qué es técnicamente posible sin saltarse las reglas
de Riot. Todo lo de aquí está verificado contra documentación oficial de
Riot/Overwolf y contra lo que declaran las propias apps (agosto 2026) — no
son suposiciones.

## El hallazgo que más importa: por qué nadie muestra el cooldown de Flash en tiempo real de forma fiable

Ninguna fuente **oficial** expone el cooldown restante de los hechizos de
invocador (ni de las habilidades Q/W/E/R) de un jugador que no seas tú:

- **Live Client Data API** de Riot (`https://127.0.0.1:2999/liveclientdata/*`,
  la misma que ya usa `liveclient.rs`): el campo `summonerSpells` de cada
  jugador en `/allgamedata` solo trae `displayName`, `rawDisplayName` y
  `rawDescription` — identifica qué hechizo lleva equipado, no si está en
  cooldown ni cuándo se usó. `activeplayerabilities` (solo para TI, nunca
  para otros jugadores) tampoco trae un cooldown restante, solo metadatos de
  la habilidad (`abilityLevel`, `displayName`, `id`, descripciones).
- **Overwolf GEP para LoL** (la integración que usan Blitz/Porofessor/Mobalytics
  al estar publicadas en la store de Overwolf, más profunda que la API pública
  de Riot): sí expone `ult_cd` (cooldown de la ulti) pero **solo para tu
  equipo** (`team_frames_0..3`), nunca para el rival; y el evento
  `usedAbility` **solo dispara para ti mismo**, nunca para otro jugador —
  literalmente no hay evento "enemigo usó hechizo de invocador" en ningún
  sitio (hay una idea abierta sin resolver en el portal de Overwolf pidiendo
  justo eso: [Add "Summoner Spell Used" events](https://ideas.overwolf.com/ideas/OWPLAT-I-1065)).

**Consecuencia**: cuando una app muestra "Flash: 0:42" de un rival, no lo está
leyendo de ninguna API — lo está **calculando** a partir de un marcado manual
del usuario (clic en el icono cuando ve usarse el hechizo) más el cooldown
base del hechizo. iTero lo llama explícitamente "manual summoner spell
tracker"; hay proyectos pequeños dedicados solo a esto
([lol-spell-timer](https://github.com/lovelybbq/lol-spell-timer),
[SummonerTrackerOverlay](https://github.com/CodeIsJustLikeMagic/SummonerTrackerOverlay),
este último con sincronización entre compañeros de equipo vía backend propio,
no vía datos de Riot). No hay atajo mágico que nos estemos perdiendo — es una
limitación real y compartida por todos.

**Si se implementa esto en RiftCompass**, la única forma honesta (y coherente
con la política de "Honestidad de datos" del `CLAUDE.md`) es: marcado manual
por el jugador + cooldown base sacado de Data Dragon `summoner.json` (mismo
mecanismo que ya usa `ddragon.ts`/`fetchChampionMap` para campeones, no
hardcodear los segundos a mano porque cambian con las temporadas) + reducción
si el objetivo lleva botas de Ionia (-10%) o runas conocidas (Cosmic Insight,
etc.) cuando se pueda inferir del draft. Mostrarlo siempre como estimación
("~") igual que ya se hace con el oro ajeno en `goldForPlayer` — nunca como un
dato exacto, porque no lo es.

## Los timers de jungla/objetivos sí son automáticos — pero solo los de dragón/heraldo/barón

`liveclient.rs` ya trae `/allgamedata` completo, que incluye un array
`Events` que **hoy no se está leyendo en el frontend** (`OverlayView.tsx` solo
usa `gameData.gameTime`, `activePlayer`, `allPlayers`). Los nombres de evento
documentados oficialmente por Riot
([liveclientdata_events.json](https://static.developer.riotgames.com/docs/lol/liveclientdata_events.json))
son exactamente estos, con estos campos:

| EventName | Campos |
|---|---|
| `GameStart` | — |
| `MinionsSpawning` | — |
| `FirstBrick` | `KillerName` |
| `TurretKilled` | `TurretKilled`, `KillerName`, `Assisters` |
| `InhibKilled` | `InhibKilled`, `KillerName`, `Assisters` |
| `DragonKill` | `DragonType`, `Stolen`, `KillerName`, `Assisters` |
| `HeraldKill` | `Stolen`, `KillerName`, `Assisters` |
| `BaronKill` | `Stolen`, `KillerName`, `Assisters` |
| `ChampionKill` | `VictimName`, `KillerName`, `Assisters` |
| `Multikill` | `KillerName`, `KillStreak` |
| `Ace` | `Acer`, `AcingTeam` |

Todos traen `EventID` y `EventTime` (segundos desde el inicio de partida).
Con esto, un timer de "dragón/heraldo/barón vuelve a spawnear en X" **sí es
100% automático y exacto** — se calcula `EventTime` del último `DragonKill`/
`BaronKill`/`HeraldKill` + el delay de respawn fijo del objetivo (ese delay
cambia de temporada en temporada por balance, así que si se implementa debe
vivir en una constante propia fácil de revisar, no clavado en el JSX). Esto
es justo lo que anuncian Porofessor/Blitz como "objective timers" — no hay
truco, es leer `Events` y hacer una resta.

**Los timers de campamentos individuales de jungla (raptors, lobos, buff
azul/rojo...) son otra historia**: Riot no emite ningún evento cuando muere un
camp normal (solo los "épicos" de la tabla de arriba), así que no hay forma
100% oficial de saber cuándo se limpió un camp cualquiera. Las herramientas
antiguas que lo hacían (ej. `LoL-Automatic-Jungle-Timers`) lo conseguían leyendo
el minimapa por OCR/lectura de pantalla, y ese enfoque:

1. Está fuera de lo que exponen LCU/Live Client Data API (que es lo único que
   toca RiftCompass hoy, por diseño).
2. Riot ya integró un jungle tracker propio en el cliente del juego (ajustes
   del HUD in-game) desde hace varias temporadas, así que el hueco que
   llenaban esas apps ya no existe para el jugador medio.
3. Con **Riot Vanguard** (anticheat a nivel de kernel, obligatorio desde 2024)
   cualquier técnica que no sea "leer las APIs oficiales locales" se trata
   como software no autorizado — la propia comunidad reporta que las
   herramientas de lectura de memoria dejaron de funcionar.

**Recomendación: no perseguir timers de campamentos individuales.** No aporta
frente a lo que ya da el cliente oficial y el único camino técnico para
conseguirlo por nuestra cuenta es el que Vanguard bloquea. Sí tiene sentido
el timer de dragón/heraldo/barón (automático, gratis con los datos que ya
llegan) y quizá inhibidores/torretas (mismo mecanismo, mismo array `Events`).

## Qué es "legal" hacer en 2026 (contexto para no desviarse sin querer)

- Ventanas overlay normales, siempre-encima, leyendo LCU + Live Client Data
  API: **permitido explícitamente**, exactamente el modelo que ya sigue
  RiftCompass (`windows.ts`/`game-connection.ts` en el Electron viejo, y su
  equivalente en `src-tauri`). Esto es justo lo que hacen Blitz, Porofessor,
  Mobalytics y iTero.
- Lectura de memoria del proceso del juego, packet sniffing, hooks de
  proceso: la política de terceros de Riot lo trata como software no
  autorizado, y Vanguard (kernel-level, obligatorio) lo bloquea activamente
  en la práctica.
- Apps publicadas en la store de Overwolf están vetadas por Riot/Overwolf y
  por eso pueden usar el GEP (más rico que la API pública, pero solo
  disponible si se construye sobre el runtime de Overwolf — no es algo a lo
  que una app Tauri independiente pueda acceder). No es nuestro caso ni hace
  falta serlo: todo lo que aporta valor real (oro, CS/min, objetivos) ya está
  en la API pública que RiftCompass usa.
- Fuente: [Vanguard FAQ for Third Party Applications](https://www.riotgames.com/en/DevRel/vanguard-faq)
  (Riot, oficial).

## Comparativa rápida: qué muestra cada rival y cómo lo consigue

| Feature | iTero | Blitz | Porofessor | Cómo se consigue (mecanismo real) |
|---|---|---|---|---|
| Diferencia de oro (equipo/jugador) | ✅ | ✅ | ✅ (con gráfico @10/@20 min) | Automático y exacto — Live Client Data API (`activePlayer.currentGold` para ti; para el resto solo hay precio de objetos visibles, es estimación — **RiftCompass ya lo tiene**, ver `goldForPlayer` en `OverlayView.tsx`) |
| CS/min | ✅ | ✅ | ✅ | Automático y exacto (`scores.creepScore` / tiempo) — **RiftCompass ya lo tiene** |
| Cooldown de hechizo de invocador (Flash, etc.) | ✅ (marcado manual) | ✅ (no confirmado si manual o solo propio) | ✅ (anunciado, mecanismo no público) | Sin API oficial para terceros — marcado manual + cooldown base, ver sección de arriba. **RiftCompass no lo tiene** |
| Timer de dragón/heraldo/barón | — | ✅ | ✅ | Automático — evento `DragonKill`/`HeraldKill`/`BaronKill` de `Events` + delay fijo de respawn. **RiftCompass no lo tiene aunque ya recibe los datos** |
| Timer de camps individuales de jungla | ✅ (anunciado) | ✅ | ✅ | Sin API oficial fiable hoy — o aproximación estática, o redundante con el tracker propio del cliente de Riot. **No recomendado implementarlo** |
| Cooldown de ulti (propio/aliados) | — | ✅ (portrait de aliados) | — | Solo posible vía Overwolf GEP (`ult_cd`, team-scoped) — no disponible fuera de una app Overwolf. **No implementable en Tauri sin ese runtime** |
| Sugerencia de pick en champ select | ✅ | ✅ | — | Lógica propia sobre datos de composición — **RiftCompass ya lo tiene** (`draft-help.ts`) |
| Import de última build | — | ✅ | — | LCU match-history del propio jugador — **RiftCompass ya lo tiene** (`build-import.ts`) |
| Orden de habilidades sugerido | ✅ | ✅ | — | Requiere datos agregados de build/winrate que RiftCompass no tiene (política de "no fabricar stats" del `CLAUDE.md`) — no aplicable sin una fuente de datos real |
| Valor total de objetos por jugador | ✅ | ✅ | — | Suma de `price` de `playeritems` — **RiftCompass ya lo tiene parcialmente** (se muestran los iconos, no el total en número) |

## Resumen accionable para cuando se retome el overlay

1. **Gratis con los datos que ya llegan, falta solo pintar la UI**: timer de
   dragón/heraldo/barón leyendo el array `Events` de `/allgamedata` que
   `liveclient.rs` ya trae completo pero el frontend descarta. Es la mejora
   de mayor relación valor/esfuerzo.
2. **Con esfuerzo medio, siendo honestos sobre que es una estimación**:
   cooldown de hechizos de invocador vía marcado manual del propio jugador +
   tabla de cooldowns base de Data Dragon `summoner.json`. Mostrar siempre
   con el mismo prefijo "~" que ya usa el oro estimado — nunca como dato
   exacto.
3. **No perseguir**: timers de campamentos individuales de jungla (sin API
   oficial viable, y redundante con el propio cliente de Riot) ni cooldown de
   ulti ajena (solo disponible vía runtime de Overwolf, incompatible con ser
   una app Tauri independiente).
4. Todo esto respeta el modelo actual (solo LCU + Live Client Data API, sin
   lectura de memoria ni OCR) — no hace falta ni se debe cambiar de enfoque
   técnico para conseguir ninguna de estas mejoras.

## Fuentes

- [Riot Developer Portal — Live Client Data API](https://developer.riotgames.com/docs/lol)
- [Sample events JSON (oficial, lista completa de EventName)](https://static.developer.riotgames.com/docs/lol/liveclientdata_events.json)
- [Overwolf — League of Legends Game Events (GEP)](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/league-of-legends/)
- [Overwolf Ideas Portal — falta de evento de summoner spell usado](https://ideas.overwolf.com/ideas/OWPLAT-I-1065)
- [Riot — Vanguard FAQ for Third Party Applications](https://www.riotgames.com/en/DevRel/vanguard-faq)
- [Blitz.gg — League of Legends Overlays](https://blitz.gg/overlays/lol)
- [Porofessor.gg](https://porofessor.gg/)
- [iTero.gg](https://www.itero.gg/)
- [lol-spell-timer (ejemplo de tracker manual de hechizos)](https://github.com/lovelybbq/lol-spell-timer)
- [SummonerTrackerOverlay (ejemplo de tracker manual sincronizado entre equipo)](https://github.com/CodeIsJustLikeMagic/SummonerTrackerOverlay)
