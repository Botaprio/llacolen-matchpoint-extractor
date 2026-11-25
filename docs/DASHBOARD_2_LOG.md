# Dashboard 2.0 — Log de implementación
Fecha: 2026-11-25 13:59

## CAMBIOS IMPLEMENTADOS

### 1. Filtro de nombres en clases nuevas/retiradas
Función isRealClassName() agegada en dashboard-generator.js.

**Criterios de rechazo:**
- Contiene "VS" como palabra (partidos de fútbol: "Fase de Grupos ... VS ...")
- Empieza con "Fase de/Inicial/Regular/Final" (fases de torneo)
- Empieza con "campeonato", "copa", "torneo"
- Contiene "halloween", "americano halloween/mixto"
- Es "interclubes", "mantencion", "runners", "s/p", "desayuno running", "squash camp"
- Patrón de nombre de persona: 2+ palabras todas con mayúscula inicial, solo letras, sin dígitos, sin keywords de actividad

**Criterios de aceptación:**
- Contiene algún keyword de actividad física/deportiva (acuaerob, spinning, yoga, natación, fitness, fútbol, etc.)
- Si no cumple ningún criterio explícito → se incluye por defecto

**ALERTA:** El heurístico puede cometer errores en casos ambiguos. Revisar los resultados
periódicamente para ajustar la lista de keywords si aparecen falsos positivos/negativos.

### 2. Tarjetas de actividad (galería)
Los botones "Ver gráfico" y "Tendencia" ahora se apilan verticalmente dentro de un div
.gallery-card-btns (flex-direction: column), eliminando el solapamiento.

### 3. Selector de período
- Runs ordenados de más antiguo a más nuevo (izquierda a derecha)
- El período seleccionado por defecto es el más reciente
- Se agregan botones de año sobre las tabs de meses
- Clic en un año filtra las tabs para mostrar solo los meses de ese año
- Clic en el mismo año deselecciona (vuelve a mostrar todos)

### 4. Modo Presentación (nuevo)
Genera un HTML de pantalla completa con:
- Diapositivas animadas (slide-left/fade)
- Navegación: teclas ←→, Space, Home, End, F (pantalla completa)
- Botón de auto-advance (7 segundos por slide)
- Selector de período en la barra superior
- Protección con clave (mismo sistema que el dashboard)

**Slides generadas:**
1. Portada (logo + título + fecha)
2. Resumen del período (5 KPIs: eventos, inscritos, cupos, clases, ocupación)
3. Distribución por categoría (barras horizontales con % ocupación)
4. Divisor de mes (título grande)
5. Indicadores del mes (KPIs + clases nuevas)
6. Clases incorporadas (si hay mes anterior) → chips verdes
7. Clases no detectadas (si hay mes anterior) → chips grises
8. Ranking: Mayor ocupación % (top 8)
9. Ranking: Menor ocupación % (bottom 8)
10. Ranking: Mayor inscripción (top 8)
11. Ranking: Menor inscripción (bottom 8)
12-N. Una diapositiva divisor + una diapositiva de detalle por cada categoría
   (con todas sus actividades, barras de ocupación, badge "NUEVA" cuando corresponde)
N+1. Cierre

**Actividades nuevas:** Se marca con badge "NUEVA" (en amarillo) cualquier actividad nueva,
y se destaca especialmente si su nombre contiene "EXPLORADOR/EXPLORADORES".

## DUDAS Y PUNTOS PENDIENTES

### Piscina: divisiones de Natación
El usuario menciona que Natación tiene 2 divisiones "que no recuerdo".
**No fue posible verificar los nombres exactos** sin acceso a los datos reales de MatchPoint.
La presentación mostrará las divisiones tal como aparezcan en el campo division de cada slot
(extraído del descriptor de MatchPoint por parseDescriptorDivision()).
Divisiones probables: "Adultos" / "Infantil" / "Avanzado" / "Principiantes" / "Escuela" — 
confirmar revisando los datos extraídos.

### Menores: "algo con kids"
El usuario no recuerda el nombre exacto. Probablemente "Fútbol Kids", "Mini Fútbol Kids"
o "Soccer Kids". La presentación mostrará la actividad con su nombre real del sistema.

### Musculación
No aparece como categoría separada en WORKBOOK_META. Puede estar dentro de
"Actividades Deportivas". Si es una hoja separada en ese Excel, ya aparecerá en la
diapositiva de "Actividades Deportivas". Consultar si requiere extraerla como grupo propio.

### Arte
Mapeado a la categoría "Otras Actividades". Si hay actividades artísticas en otra categoría
(ej. dentro de Inclusivas), no aparecerán en ese grupo. Revisar la estructura real.

### Colores institucionales
Se usan: azul oscuro #004a87, amarillo #f6c900, fondo presentación #071a2d.
Si hay una guía de identidad visual oficial diferente, ajustar las variables CSS.

### Logo
Se usa logo-llacolen.jpg. Si existe versión en fondo transparente (PNG), mejoraría
la presentación (especialmente en el slide de portada).

## VERSIÓN
Versión 1.0.18 → este cambio corresponde a funcionalidades del Dashboard 2.0.

## ACTUALIZACIÓN — Presentación v2 + fixes dashboard

### Presentación rediseñada
- **Pantalla de selección** al abrir: elige mes específico o rango
- **Modo rango**: tendencia de inscripción, tendencia de ocupación (Chart.js líneas), comparación por categoría, resumen del rango
- **Layout**: cada slide ocupa el 100% de la pantalla; headers compactos; lex:1 en el body
- **Fuentes más grandes**: clamp() agresivo, KPIs con fuente hasta 4rem
- **Logos**: aumentados a clamp(70px,10vh,120px) en portada
- **Gráficos Chart.js**: category overview, category detail, trend lines, combo bar+line
- **Animaciones**:
  - Entrada del slide: 	ranslateX(100%) → 0 (siguiente), 	ranslateX(-110%) → 0 (anterior)
  - Items en cascade: nim-stagger con delays escalonados
  - Barras de ranking: animan desde 0
  - Sección divider: fadeInUp + scaleIn por elemento
  - Botón de inicio: glowPulse continuo

### Dashboard — fix adicional
- Rechaza ahora: (sin nombre), (actividad sin nombre), marat[oó]n, cuadrangular, competencia
- "Clases no detectadas" → "**Clases eliminadas**" con descripción: "Estaban en [mes anterior] y ya no aparecen"
