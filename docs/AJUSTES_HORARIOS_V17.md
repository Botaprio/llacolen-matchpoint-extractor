# V17 — ajustes de horario y registro de inconsistencias

Esta revisión conserva la extracción con hasta 31 pestañas y agrega una regla común al análisis, Excel, PDF y PowerPoint.

## Asignación de una clase

1. Se resuelven primero las coincidencias exactas de actividad, día de semana y horario de las plantillas oficiales.
2. Una clase sin coincidencia exacta puede asignarse a un horario compatible del mismo día con una diferencia de hasta 15 minutos, tanto antes como después. Se mantiene la distinción de familias y grupos de actividad del catálogo. Se prefiere la mejor correspondencia de actividad y luego la hora más cercana.
3. El mismo ID de MatchPoint y fecha sólo se contabiliza una vez. Una lectura exacta tiene prioridad sobre otra lectura desfasada del mismo evento.
4. No se ajusta una clase si otra ya ocupa esa fecha y fila. Tampoco se decide arbitrariamente entre horarios equidistantes, registros contradictorios o varias clases que compiten por el mismo destino. Esos casos quedan pendientes y excluidos de las cifras oficiales.
5. Desfases superiores a 15 minutos, fechas ausentes y horarios inválidos no se corrigen automáticamente. Las actividades ajenas a las plantillas siguen excluidas.

La comparación usa los horarios de las plantillas oficiales; no reconstruye ni certifica el calendario histórico de MatchPoint. La hora guardada y el sitio no se modifican. El ajuste sólo determina dónde se suman los datos capturados. No se inventan alumnos ni se convierte un cero real en otro valor.

Ejemplo simulado: cuatro viernes de marzo con 12 inscritos y 30 cupos cada uno; el tercero registrado a las 06:25 y los otros a las 06:30. La fila de viernes 06:30 suma 48 inscritos, 120 cupos y 4 clases. La observación identifica el tercer viernes y el ajuste de +5 minutos.

## Cuadro en los Excel

Cada hoja afectada incluye un cuadro **Observaciones de horario**, situado debajo de las estadísticas y del espacio ocupado por sus gráficos. Informa fecha, actividad, ID, inscritos, cupo, hora registrada, hora asignada, diferencia, destino y motivo. Incluye ajustes aplicados y casos pendientes relacionados con esa hoja. Se conservan las tablas, fórmulas y gráficos originales.

## TXT junto a los siete archivos

Al pulsar **Excel oficiales**, se generan los siete Excel y un archivo `Inconsistencias-horarios-AAAA-MM.txt` en la misma carpeta. Incluye el período, fecha de generación, filtro de actividades, regla aplicada, cantidades y todos los ajustes o incidencias de horario detectados entre los registros comparables con las plantillas. Se genera también cuando no hay incidencias, dejando constancia explícita. Una nueva exportación en la misma carpeta reemplaza los informes y el TXT de ese mes.

Los registros excluidos por motivos ajenos al horario se cuentan en el resumen; el TXT no sustituye la revisión completa de **Analizar Nuevo**. No es posible detectar una clase que nunca se capturó.

## Análisis y extracciones anteriores

**Analizar Nuevo** incorpora los filtros **Horarios ajustados** y **Horarios por revisar**, y deja de marcar como fuera del informe las clases que se recuperaron correctamente. El análisis mensual indica cuántos ajustes se aplicaron.

Si la extracción anterior ya guardó la clase con su hora desfasada y sus inscritos, basta con volver a analizar y exportar tras actualizar la aplicación. Si esos datos no se capturaron, será necesario extraer el período nuevamente.

## Validación

Pruebas automatizadas con datos simulados: marzo con el tercer viernes desplazado; adelantos y atrasos de 2, 5, 10 y 15 minutos; rechazo a 16 minutos; conservación de la fuente; prioridad de coincidencias exactas; duplicados; destinos ocupados; conflictos; empates; filtros; notas en todas las hojas oficiales; TXT con ajustes, pendientes y ausencia de incidencias. Se verificó visualmente el cuadro de musculación mediante una previsualización del Excel generado.

No se ha revisado una base real de marzo ni se ha ejecutado esta revisión en Windows o contra MatchPoint en vivo.
