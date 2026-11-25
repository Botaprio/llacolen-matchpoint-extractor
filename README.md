# Llacolén MatchPoint Estadísticas

Aplicación de escritorio para Windows que extrae desde MatchPoint la ocupación diaria, los cupos y todos los inscritos de las actividades del **Cuadro de Reservas**.

## Versión 17 — extracción en paralelo, análisis y ajustes de horario

- El período se divide en días sin solapamiento. Por defecto trabajan 4 pestañas de Edge; se puede elegir de 1 a 31. Cada pestaña toma el siguiente día libre al terminar.
- Se utiliza la sesión ya iniciada por el usuario. No hay que iniciar sesión para cada día ni unir archivos manualmente.
- Un solo registro de extracción reúne todos los eventos en SQLite. Fecha e ID de MatchPoint impiden duplicados; los contadores finales se recalculan desde los datos consolidados.
- Los días fallidos se reintentan al final con una sola pestaña. Los días completados no se vuelven a extraer. Si queda un fallo, el estado es **Parcial**, no Completada.
- Se registra la cobertura por día, incluidos los días sin eventos. Cancelar espera a los trabajadores y conserva lo obtenido. Una ejecución interrumpida al cerrar la app se identifica al reiniciar.
- **Analizar Nuevo** aparece junto a **Analizar** en cada extracción terminada y dentro del análisis mensual. Revisa todos los eventos sin aplicar el filtro de los informes oficiales.
- La revisión muestra clase, fecha, horario, cupo, inscritos, motivo y evidencia. Permite filtrar por nivel, tipo y búsqueda. Los resultados se muestran en páginas de hasta 100 hallazgos.
- Distingue cupo cero, ausencia de inscritos y datos no leídos. También señala sobrecupos, diferencias en nombres confirmados, errores de detalle, posibles duplicados, cambios de cupo y días incompletos.
- Desfases de hasta 15 minutos se asignan al horario compatible más cercano cuando el destino está libre y la clase no está contabilizada. Los casos dudosos quedan pendientes. Cada hoja afectada muestra un cuadro debajo de las estadísticas; los siete Excel se acompañan de un TXT con ajustes y pendientes. Consulta `docs/AJUSTES_HORARIOS_V17.md`.
- Las extracciones antiguas siguen disponibles: cuando faltan datos de cobertura o confirmación del detalle, se indica la limitación en lugar de suponer ceros.

Las clases declaradas con **0/0** se guardan y se muestran para revisión. **0/15** es una clase con capacidad disponible sin inscritos y se informa por separado. La revisión no modifica MatchPoint. Los informes aplican la tolerancia de horario documentada, conservando la hora original.

Consulta `docs/CAMBIOS_V17.md` y `docs/VALIDACION_V17.json` para el alcance y las pruebas.

## Qué hace

- Abre MatchPoint en Microsoft Edge con un perfil local persistente.
- El usuario inicia sesión directamente en MatchPoint; la aplicación no recibe ni guarda la contraseña.
- Permite elegir un rango inclusivo de fechas.
- Recorre los 29 cuadros disponibles para cada día.
- Evita duplicados mediante la fecha y el ID del evento.
- Guarda actividad, horario, recurso, inscritos, cupo, porcentaje de ocupación, monitor y nombres de participantes.
- Conserva el estado de asistencia mostrado por MatchPoint (`n.d.`, `Confirmada`, `Falta`, etc.).
- Almacena todo en una base SQLite local.
- Genera los **7 Excel oficiales** usando como plantillas los archivos históricos de Llacolén, conservando nombres de archivo, pestañas, formato, estructura y gráficos.
- Genera el **PowerPoint oficial de 62 diapositivas** a partir de la plantilla histórica y reemplaza el mes/año en todas las diapositivas, incluso cuando el texto original está dividido internamente en varios fragmentos de PowerPoint.
- El PDF, los Excel y el PowerPoint aplican el mismo filtro: cualquier evento que no corresponda a las actividades/horarios definidos en las plantillas Excel queda fuera del informe.
- Los gráficos oficiales comparan **Cupos vs Asistentes**; el porcentaje de ocupación y los promedios permanecen en las tablas.

## Reglas de validación

- `0/15p`: se guarda el evento con 0 inscritos y cupo 15.
- `x/0p`: se guarda el evento y se genera la alerta `ZERO_CAPACITY`.
- Sin indicador `(x/yp)`: se guarda el evento y se genera `MISSING_ATTENDANCE_INDICATOR`.
- Inscritos mayores que el cupo: se genera `OVER_CAPACITY`.
- Cantidad del cuadro distinta al número de nombres del detalle: se genera `PARTICIPANT_COUNT_MISMATCH`.
- Si un detalle no puede abrirse o leerse, se genera `DETAIL_READ_FAILED` y el proceso continúa.


## Informes oficiales (base V16 conservada)

Las plantillas se incluyen dentro de `src/assets/report-templates/`. El programa no reconstruye su diseño desde cero: modifica directamente los archivos Office Open XML para conservar el formato original.

Los Excel generados mantienen exactamente estos nombres:

- `ACTIVIDADES DEPORTIVAS Lista.xlsx`
- `Actividades Fitness lista.xlsx`
- `Actividades Inclusivas lista.xlsx`
- `Actividades Menores lista.xlsx`
- `Escuela de Invierno.xlsx`
- `Otras Actividades LISTA.xlsx`
- `Piscina Temperada lista.xlsx`

El PowerPoint se genera como `Estadística de Actividades <Mes> <Año>.pptx`.

La lista válida contiene **464 filas de actividad/horario** derivadas de los Excel adjuntos. El filtro se ejecuta antes de generar cualquiera de los informes. Si una actividad no pertenece a una familia autorizada, no tiene un horario compatible para ese día dentro de la tolerancia o la coincidencia es ambigua, se excluye del Excel, PowerPoint y PDF.

Los informes oficiales requieren que la extracción esté contenida en **un solo mes**. Las extracciones anuales siguen pudiendo analizarse en pantalla y exportarse a PDF filtrado, pero para reproducir las plantillas Excel/PPT se debe usar una extracción mensual.


### Cambios de estabilidad en v16

- **Período mensual del PowerPoint:** se reemplaza cualquier leyenda visible de mes/año heredada de la plantilla. Esto cubre tanto textos normales como textos fragmentados por PowerPoint en varios `runs`, que era la causa de que algunas diapositivas conservaran “Junio 2025”.
- **Extracciones mensuales consecutivas:** si el Cuadro de Reservas ya está abierto tras terminar un mes, el programa lo reutiliza y espera que el último postback de MatchPoint esté estable antes de iniciar el mes siguiente.
- **Sesión durante postbacks:** una vista de reservas abierta también se considera evidencia de sesión autenticada, evitando falsos errores de acceso durante la transición.

## Requisitos

- Windows 10 u 11 de 64 bits.
- Microsoft Edge instalado.
- Node.js 24 o posterior, únicamente para desarrollo o generación del instalador.
- Una cuenta autorizada de MatchPoint con acceso al Cuadro de Reservas.

## Ejecutar en desarrollo

```powershell
npm install
npm test
npm start
```

1. Pulsa **Abrir MatchPoint**.
2. Inicia sesión manualmente en Edge.
3. Vuelve a la aplicación y pulsa **Comprobar acceso**.
4. Selecciona las fechas y pulsa **Iniciar extracción**.
5. Al finalizar, utiliza **Excel oficiales**, **Informe PDF** o **Generar PowerPoint** desde el análisis. Los informes Excel/PPT oficiales son mensuales, igual que las plantillas originales.

La sesión del navegador queda en el directorio privado de datos de la aplicación. No se escriben usuarios ni contraseñas en el código, la base de datos o los archivos de registro.

El perfil conserva cookies de sesión para evitar iniciar sesión en cada ejecución. Por esa razón, la carpeta de datos debe mantenerse dentro de la cuenta de Windows autorizada y no debe compartirse con otros usuarios.

## Crear el instalador para Windows

La primera vez, haz doble clic en **`Crear-Ejecutable-Windows.bat`**. Instala las dependencias, ejecuta las pruebas y deja el instalador y la versión portable en `dist/`.

Para versiones futuras, conserva esta misma carpeta. Extrae los archivos de la actualización sobre ella, aceptando reemplazar archivos pero **sin borrar `node_modules`**, y haz doble clic en **`Actualizar-Ejecutable-Windows.bat`**. Las dependencias se reutilizan automáticamente; sólo se vuelven a descargar si cambia `package.json`.

Si aparece un aviso de que falta Node.js, instala Node.js 24 LTS desde [nodejs.org](https://nodejs.org/) y vuelve a abrir el archivo `.bat`.

Desde PowerShell:

```powershell
.\scripts\build-windows.ps1
```

También puedes ejecutar directamente:

```powershell
npm install
npm run dist:win
```

Los archivos generados aparecerán en `dist/`:

- Versión portable `.exe`.
- Instalador NSIS `.exe`.

## Datos locales

La base se almacena bajo el directorio de datos de Electron, normalmente:

```text
%APPDATA%\Llacolén MatchPoint Estadísticas\data\matchpoint.sqlite
```

La aplicación incluye el botón **Abrir carpeta de datos** para llegar a esa ubicación sin buscarla manualmente.

## Consideraciones

- MatchPoint es un sistema ASP.NET Web Forms con componentes JavaScript antiguos. El extractor espera la actualización de cada cuadro antes de continuar.
- La V17 usa una cola de días con 1 a 31 pestañas (4 por defecto). Cada pestaña procesa sus cuadros y detalles de forma secuencial. El servidor puede limitar la ganancia de velocidad; puede usarse 1 pestaña cuando sea necesario.
- Si MatchPoint cambia IDs o clases HTML, los selectores están concentrados en `src/services/extractor.js`.
- Se recomienda comenzar con un solo día como prueba antes de ejecutar rangos extensos.
