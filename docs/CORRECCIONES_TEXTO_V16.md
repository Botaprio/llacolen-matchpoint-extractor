# Correcciones de texto — versión 16

Esta revisión mantiene el número de versión 16 y no altera la lógica de extracción ni el catálogo estructural de hojas.

## Codificación

Los archivos XLSX y PPTX son OOXML y almacenan sus XML en UTF-8. No se detectó mojibake visible (`Ã`, `Â`, `�`). Los problemas encontrados provenían principalmente de texto escrito sin tilde o con errores en la plantilla original.

La exportación normaliza el texto visible a Unicode NFC y aplica una reparación defensiva para secuencias UTF-8 mal decodificadas comunes.

## Correcciones aplicadas al texto visible

- `funcinal` → `funcional`
- `intencidad` → `intensidad`
- `inlusiva` → `inclusiva`
- `Celuar` → `Celular`
- `Miercoles` → `Miércoles`
- `Sabado` / `Sabados` → `Sábado` / `Sábados`
- `Futbol` → `Fútbol`
- `Padel` → `Pádel`
- `Basquetbol` → `Básquetbol`
- `Guarderia` → `Guardería`
- `Sicomotricidad` → `Psicomotricidad` en contenido visible
- `Acuaerobica` / `Acuarobica` → `Acuaeróbica`
- `Oleo` → `Óleo`
- `Fotografia` → `Fotografía`
- `Ceramica` → `Cerámica`
- `Edicion` → `Edición`
- `Terapeutica` → `Terapéutica`
- `Reflex` → `Réflex`
- `Mas` → `Más` cuando corresponde
- `17:000 Hrs.` → `17:00 Hrs.`
- `HIT/Hiit ... intencidad` → `HIIT: entrenamiento de intervalos de alta intensidad`
- normalización de `CrossFit`, `TRX`, `Running Kids` y capitalización de títulos.

## Títulos de gráficos

Se reemplazó la construcción poco natural `Asistentes vs cupos clases de...` por el formato uniforme:

`Asistentes vs. cupos — [actividad], [Mes Año]`

## Corrección adicional de plantilla

El gráfico **Entrenamiento Funcional Flow** incluía por error en el eje X los valores auxiliares `15,0`, `17,0`, `3,8` y `4,3`. Esos valores provenían de columnas de métricas de la plantilla y no eran categorías. En la v16 revisada el eje usa únicamente **día y horario**.

## Nombres estructurales de pestañas

Los nombres físicos de las hojas se mantienen tal como estaban en las plantillas originales porque forman parte del contrato estructural solicitado para los informes y son utilizados por el catálogo de correspondencias. Las correcciones ortográficas se aplican al contenido visible, encabezados y gráficos sin cambiar esos identificadores internos.
