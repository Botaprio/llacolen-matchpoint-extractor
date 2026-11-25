# Mapa técnico de MatchPoint

Este archivo concentra los puntos de integración observados en la instancia de Llacolén. Su objetivo es facilitar ajustes futuros si MatchPoint modifica la interfaz.

## Navegación

| Elemento | Selector o acción |
| --- | --- |
| Icono Cuadro de Reservas | `#imgCuadroReservas` |
| Iframe de contenido | `#iframeContenido` |
| Vista de reservas | `/Reservas/CuadroReservas.aspx` |
| Selector de cuadros | `select[name="ctl01$CC$DropDownListCuadros"]` |
| Campo de fecha | `#fechaTabla` |

El selector contiene actualmente 29 cuadros. El código lee las opciones en cada ejecución y no depende de una lista fija.

## Eventos

| Dato | Selector o atributo |
| --- | --- |
| Actividad | `div.evento` |
| ID del evento | atributo `id` |
| Recurso | atributo `idrecurso` |
| Inicio | atributo `inicio` |
| Fin | atributo `fin` |
| Nombre | `.eventoTexto1` |
| Inscritos y cupo | `.eventoFecha`, patrón `(x/yp)` |

Los eventos se deduplican mediante `fecha + ID`. Si falta el ID, se crea uno sintético y se genera una alerta.

## Detalle del evento

Al pulsar un evento, MatchPoint abre un iframe cuyo ID comienza con `fancybox-frame`. La tabla de inscritos se reconoce por las columnas `Nombre` y `Asistencia`, con preferencia por un ID que contenga `GridViewListadoAlumnosClase`.

El cierre se realiza mediante `#fancybox-close` o `a[title="Close"]`. La automatización nunca pulsa botones de cobro, eliminación, actualización o anulación.

## Alertas de calidad

| Código | Condición |
| --- | --- |
| `MISSING_ATTENDANCE_INDICATOR` | No aparece `(x/yp)` |
| `ZERO_CAPACITY` | El cupo informado es 0 |
| `OVER_CAPACITY` | Inscritos mayores que el cupo |
| `PARTICIPANT_COUNT_MISMATCH` | El total informado no coincide con los nombres leídos |
| `DETAIL_READ_FAILED` | No fue posible abrir o interpretar el detalle |
| `MISSING_EVENT_ID` | MatchPoint no entregó ID para el evento |
