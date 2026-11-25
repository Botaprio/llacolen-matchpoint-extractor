# V17 — extracción paralela y revisión de clases

Fecha: 10 de septiembre de 2026. Versión de aplicación: 1.0.17.

## Base utilizada

Esta entrega deriva del ZIP V16 con las correcciones de fechas y texto del 4 de septiembre (guardado el 5 de septiembre en UTC). Las plantillas Office y el catálogo de 464 filas conservan exactamente sus bytes. El exportador se amplió para agregar observaciones de horario y un TXT; se mantienen las correcciones de tildes y meses. Se corrigió el nombre del archivo de la plantilla PowerPoint dentro del ZIP para que se codifique correctamente en UTF-8.

SHA-256 del ZIP V16 original: `bde4f0030f1d7bc62b065c254ef002f3670cae1ed158129f68535d036e8bfe4e`.

## Revisión de horarios

Se incorporan ajustes de hasta 15 minutos, con prioridad exacta, prevención de doble conteo, cuadro de observaciones por hoja y TXT junto a los siete Excel. Los detalles están en `AJUSTES_HORARIOS_V17.md`.

## Cómo se reparte un mes

1. Se genera una cola inclusiva con todos los días solicitados, sin solapamientos.
2. Trabajan cuatro pestañas de Edge por defecto, ajustables entre una y treinta y una. Si el rango tiene menos días, se abren sólo las necesarias.
3. Cada pestaña procesa un día completo, recorriendo sus cuadros y detalles. Cuando termina, toma el siguiente día libre. Los días con menos actividad no dejan una pestaña esperando a que termine una semana más cargada.
4. Los datos se guardan en un solo registro de extracción, mediante un único escritor SQLite. La combinación fecha e ID de evento evita duplicados entre cuadros. El mismo ID en fechas distintas conserva cada clase.
5. Si hay cifras contradictorias para el mismo evento entre cuadros, se conserva la primera lectura y se registra el conflicto para revisión.
6. Los días fallidos se reintentan al final en una sola pestaña; los días completados se conservan. Si persiste un fallo, la extracción se marca Parcial.
7. La interfaz muestra cada pestaña, día asignado, estado, progreso global y totales consolidados. Un día terminado no hace aparecer 100% para todo el mes.

La pestaña original de inicio de sesión se conserva; se cierran únicamente las pestañas auxiliares creadas por el coordinador. No se manipulan cookies ni credenciales. Cancelar espera a los trabajadores y conserva los datos alcanzados. La cobertura por día queda registrada y una interrupción de la aplicación se identifica al reiniciar.

El modo **Extraer mes** captura cifras y detalles. **Extracción rápida (cifras)** omite nombres/estados individuales, como en V16. Ambos utilizan el número de pestañas elegido.

La solución utiliza el soporte de [múltiples páginas de Playwright](https://playwright.dev/docs/pages). La mejora real depende de MatchPoint: ASP.NET puede serializar solicitudes de una misma sesión según su configuración, como explica [Microsoft sobre estado de sesión y solicitudes concurrentes](https://learn.microsoft.com/en-us/previous-versions/aspnet/ms178581(v=vs.100)). No se promete una reducción fija del tiempo ni se asume que treinta y una pestañas superen siempre a cuatro.

## Analizar Nuevo

El botón aparece junto a **Analizar** en el historial, y también dentro del panel de análisis mensual. Puede revisar extracciones completas, parciales, fallidas o canceladas. Recalcula una revisión de sólo lectura sobre todos los eventos capturados, sin el filtro de los informes oficiales.

| Caso | Tratamiento |
| --- | --- |
| Clase declarada 0/0 | Advertencia: confirmar cierre, suspensión o configuración. No se omite. |
| Clase declarada con inscritos y cupo 0 | Error: configuración incompatible con los inscritos. Ocupación no calculable. |
| Clase 0/15 | Informativo: sin inscritos, con cupo disponible. |
| Cupo o inscritos ausentes | Dato no leído; no se convierte en cero. |
| Inscritos mayores al cupo | Error por sobrecupo. |
| Número de nombres distinto a inscritos | Advertencia sólo cuando el detalle fue leído y confirmado. |
| Detalle fallido o modo cifras | Se informa que los nombres/asistencia no están verificados; no se inventa una discrepancia. |
| Mismo evento con cifras distintas | Error con las dos lecturas originales. |
| Clases con mismo día, horario y recurso pero distinto ID | Posible duplicado para revisión; se conservan ambas. |
| Cupos distintos en la misma actividad, día de semana, horario y recurso | Advertencia, pues también puede ser un ajuste válido. |
| Evento fuera del informe oficial | Informativo con la causa de exclusión. |
| Día sin todos sus cuadros confirmados | Error de cobertura; el mes puede estar incompleto. |

Los filtros permiten seleccionar nivel, tipo y texto. La tabla indica actividad, fecha, horario, inscritos, cupo y hallazgo. **Ver evidencia** muestra ID, cuadros de origen, indicador original, cantidad de nombres verificada, ocupación y pertenencia al informe oficial. Se muestran hasta 100 hallazgos por página.

Las revisiones antiguas conservan sus datos; si no hay registro de cobertura o lectura de detalle, se informa que no puede certificarse. Esta auditoría no supone que todas las clases de una plantilla histórica debían realizarse en el mes consultado. Tampoco puede demostrar la existencia de clases que nunca aparecieron en los cuadros capturados.

## Compatibilidad y actualización

- Se conservan la identidad de la aplicación, el directorio de datos, el inicio manual de sesión y las dependencias de V16.
- La migración agrega campos/tablas sin borrar extracciones existentes. Se conserva la separación entre revisión y exportación oficial.
- El script de compilación se detiene si falla la instalación, las pruebas, la comprobación de código o la compilación. No informa éxito después de un comando fallido.

Para actualizar la carpeta de desarrollo actual, copia dentro de ella el contenido de `Llacolen-MatchPoint-Estadisticas-v17`, aceptando reemplazar archivos y conservando `node_modules`. Ejecuta `Actualizar-Ejecutable-Windows.bat`. Los ejecutables e instalador se generan en `dist`. También puedes trabajar en la carpeta nueva con `Crear-Ejecutable-Windows.bat`.

Esta entrega incluye código fuente y scripts de compilación; no incluye un EXE precompilado.

## Validación efectuada

- 44 pruebas automatizadas aprobadas, sin fallos.
- 13 archivos JavaScript pasan la comprobación de sintaxis.
- Cola con hasta 31 trabajadores simultáneos: cobertura en rangos de 31, 29 y 1 días, apertura limitada a los días disponibles y consolidación sin duplicados.
- Reintento exclusivo del día fallido, fallo persistente como Parcial, cancelación, cierre de auxiliares y alternativa de una sola pestaña.
- Persistencia de clases 0/0 y 0/15, conflictos entre cuadros y rechazo de una captura con fecha o cuadro distintos.
- Migración del esquema V16 sin cambiar datos/identificadores y recuperación de extracciones interrumpidas.
- Controlador de interfaz e IPC: el botón abre la extracción elegida, filtra cupo cero y transmite la concurrencia.
- Regresión de los siete Excel, 62 diapositivas y 54 gráficos del PowerPoint, meses, tildes, Flow y catálogo.

Las pruebas del navegador/extracción utilizan dobles controlados de MatchPoint. Las pruebas de interfaz comprueban su controlador y contrato IPC, no son una validación visual de Electron. No se ejecutó un EXE en Windows ni una extracción en vivo; esas comprobaciones y la medición de velocidad deben realizarse con la sesión autorizada del usuario.
