# Informes oficiales v15

## Fuente de verdad

Los siete Excel y el PowerPoint de junio de 2025 entregados por el usuario son las plantillas maestras de los informes. Se preservan sus nombres, pestañas, orden, celdas combinadas, anchos, alturas, estilos, disposición y gráficos.

## Regla de inclusión

Un evento extraído desde MatchPoint sólo puede entrar a un informe cuando:

1. su nombre pertenece a una familia de actividad existente en los Excel;
2. existe una fila compatible por día y hora;
3. cuando varias filas comparten horario, el nombre/grupo permite resolver una sola fila.

Una coincidencia ambigua se excluye. Es preferible omitir un evento dudoso antes que incorporarlo a una actividad incorrecta.

La misma regla se usa para:

- los 7 Excel oficiales;
- el PowerPoint oficial;
- el análisis en pantalla;
- el PDF.

## Estructura calculada

Para cada fila de actividad/horario se agregan las ocurrencias reales del mes:

- Total de asistentes = suma de inscritos;
- Cantidad de cupos = suma de cupos;
- Cantidad de clases = cantidad de eventos/clases encontradas;
- % de ocupación = asistentes / cupos × 100;
- Cupos por clase = cupos / clases;
- Promedio de asistentes por clase = asistentes / clases.

Los tres últimos campos quedan como fórmulas con valor cacheado y cálculo automático al abrir Excel.

## Gráficos

La plantilla original mezclaba `% de ocupación` con `Promedio de asistentes por clase` en el mismo eje. v15 conserva el aspecto y la ubicación de los gráficos 3D, pero usa dos magnitudes comparables:

- Cupos
- Asistentes

Esto se aplica a los 53 gráficos de los Excel y a los 54 gráficos del PowerPoint.

## Alcance mensual

Los Excel/PPT oficiales reproducen un informe mensual. Si una extracción cruza meses, el programa solicita usar una extracción mensual para estos dos formatos. El análisis/PDF puede seguir utilizándose con rangos mayores, siempre aplicando el filtro de actividades autorizadas.
