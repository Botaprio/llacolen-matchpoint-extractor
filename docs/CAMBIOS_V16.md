# Cambios v16

## 1. Mes/año consistente en PowerPoint

La plantilla histórica contiene `Junio 2025`. Algunas diapositivas guardan ese texto en un único nodo XML y otras lo dividen en dos fragmentos, por ejemplo `J` y `unio 2025`. La v15 sólo reemplazaba el caso contiguo.

La v16 reconstruye el texto visible de cada párrafo y sustituye cualquier patrón `<Mes> <Año>` por el período de la extracción mensual. Los gráficos también reciben el mismo período.

## 2. Extracción rápida mes a mes

Al terminar el último cuadro MatchPoint puede mantener un postback ASP.NET activo durante un intervalo breve. La v16:

1. espera una ventana corta de estabilidad antes de declarar terminada la extracción;
2. detecta si el Cuadro de Reservas ya quedó abierto;
3. reutiliza esa vista en vez de volver a pulsar el icono;
4. tolera durante unos segundos la desaparición transitoria del icono superior si el tablero sigue autenticado.

Esto elimina la principal condición de carrera que hacía fallar el primer intento de iniciar el mes siguiente.

## Revisión tipográfica y ortográfica (misma v16)

- Normalización Unicode NFC / UTF-8 defensiva en texto visible de XLSX y PPTX.
- Corrección de tildes y erratas heredadas de las plantillas.
- Títulos de gráficos normalizados a `Asistentes vs. cupos — actividad, mes año`.
- Corrección del eje X del gráfico Entrenamiento Funcional Flow, que incluía valores auxiliares como categorías.
- Se preservan los nombres estructurales de las pestañas para mantener compatibilidad con las plantillas oficiales.
