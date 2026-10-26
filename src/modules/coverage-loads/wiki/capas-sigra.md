---
title: "Etapa Capas SIGRA"
order: 5
---

# Etapa Capas SIGRA

Esta etapa actualiza en la base las capas de **SIGRA** que usa el cálculo de **Avance FTTH**. Es la primera etapa del tipo de carga **FTTH** y **no se puede omitir**: la etapa Avance FTTH queda bloqueada hasta que esta esté completada.

> [!NOTE]
> Las dos capas **obligatorias** son las zonas FTTH y los límites de centrales FTTH. Son las que necesita el Avance. Las demás capas son opcionales y se cargan por si hacen falta más adelante; no condicionan ningún paso.

## Qué carga

Son 18 capas, agrupadas en la tabla:

| Grupo | Capas |
|---|---|
| **Necesarias para Avance FTTH** | Zonas FTTH (obligatoria) y Límites de centrales FTTH (obligatoria). |
| **Áreas** | Áreas CD SR, Áreas de cable cobre, Áreas de cable FTTH, Áreas de cajitas cobre, Áreas de TFO. |
| **Centrales y límites** | Límites de centrales cobre, Límite económico cobre, Límite mixto cobre, Centrales cobre, Centrales FTTH. |
| **Cajas y divisores** | Cajas de distribución, Cajitas cobre, TFO y divisores. |
| **Red y seguridad** | Cámaras, Postes, Zonas de inseguridad. |

Cada capa se carga en su propia tabla de la base. La tabla de cada capa aparece en la columna de la capa, debajo de su nombre.

## Antes de empezar

- Tener confirmada la conexión y haber elegido el tipo de carga **FTTH**.
- Que su usuario tenga los permisos de la sección *Permisos* de [Preguntas frecuentes](preguntas-frecuentes.md).
- Que el servidor pueda consultar SIGRA. Si no puede, el plan lo informa y no deja cargar.

## Pasos

1. **Actualizar estado.** Presione **Actualizar estado**. La herramienta lee cada tabla y consulta SIGRA para saber cuántos registros publica cada capa. Esta lectura no modifica nada.
2. **Revisar la tabla.** Cada fila muestra:

   | Columna | Qué significa |
   |---|---|
   | **Capa** | Nombre de la capa y la tabla de destino. |
   | **Registros actuales** | Cuántos registros tiene hoy la tabla. |
   | **Última actualización** | Fecha de la última carga de la tabla. |
   | **Registros en SIGRA** | Cuántos registros publica SIGRA ahora. |
   | **Variación** | Registros en SIGRA menos registros actuales. Un signo `+` indica que SIGRA tiene más; un `-`, que tiene menos. `—` significa que no hay dato. |

   Si una capa tiene un problema (por ejemplo, falta un privilegio o la tabla no existe), aparece el motivo debajo de su nombre. Un motivo impide cargar esa capa.
3. **Elegir las capas.** Marque las capas que quiere cargar. Las obligatorias vienen marcadas y no se pueden desmarcar. Los botones **Seleccionar todas** y **Solo obligatorias** cambian la selección de una vez.
4. **Probar o cargar.**
   - **Probar sin guardar** hace todo el recorrido (descarga, validación y reemplazo) y deshace el resultado. No queda nada guardado. Úselo primero.
   - **Cargar y reemplazar** muestra un cuadro de confirmación con el texto *"Se reemplazará el contenido de N tablas con lo que hoy publica SIGRA..."*. Solo se ejecuta si presiona **Confirmar y reemplazar**. **Cancelar** cierra el cuadro sin cambios.
5. **Ver el resultado.** Al terminar se abre la ventana del resultado (ver abajo). Si la cierra, **Ver último resultado** la vuelve a abrir.

> [!WARNING]
> **Cargar y reemplazar** cambia el contenido de las tablas y **no se puede deshacer** desde la herramienta. Haga primero una prueba sin guardar.

> [!TIP]
> La carga puede tardar varios minutos. Mientras tanto, la pantalla muestra *"Cargando las capas seleccionadas desde SIGRA"*.

## Cómo se decide si una capa se carga

La herramienta descarga la capa completa y la valida **antes** de tocar la tabla:

- Si la tabla está vacía, la carga se acepta.
- Si no, la carga se acepta solo si la descarga tiene **al menos el 97 %** de los registros que tiene hoy la tabla.

Si la descarga es menor, la capa queda como **Rechazada por validación** y su tabla **no se modifica**. El mensaje indica cuántos registros se descargaron, cuántos tiene la tabla y el porcentaje obtenido.

En el plan, una advertencia avisa antes de cargar si SIGRA publica menos del 97 % de los registros actuales de una capa.

## Resultado

La ventana muestra una fila por capa seleccionada:

| Columna | Qué significa |
|---|---|
| **Capa** | Capa cargada. |
| **Estado** | Ver la tabla de estados. |
| **Recibidos de SIGRA** | Registros que llegaron desde SIGRA. |
| **Válidos (sin repetir)** | Registros que quedan después de descartar repetidos. |
| **Repetidos descartados** | Registros de SIGRA con un identificador ya cargado. Se descarta el repetido. |
| **Tabla antes** | Registros que tenía la tabla antes de la corrida. |
| **Tabla ahora** / **Tabla (sin cambios)** | Registros de la tabla después de la corrida. En una prueba dice *sin cambios*. |
| **Variación** / **Variación (estimada)** | Diferencia entre la tabla antes y después. En una prueba es una estimación. |

| Estado | Significado |
|---|---|
| **Cargada** | La tabla se reemplazó con los datos de SIGRA. |
| **Prueba correcta** | La prueba terminó bien. No se guardó nada. |
| **Rechazada por validación** | No llegó al 97 %. La tabla no se modificó. |
| **Con error** | Algo falló. El resultado indica en qué paso: *Conexión*, *Descarga SIGRA*, *Inserción*, *Validación* o *Reemplazo de la tabla*. |

Si la capa quedó con error, la tabla no queda a medias: la carga se deshace.

## Estado de la etapa

La etapa figura como **Completado** solo después de una **carga real** en la que las dos capas obligatorias quedaron cargadas. Una prueba no cambia el estado. Mientras tanto, la etapa Avance FTTH muestra: *"Complete primero Capas SIGRA para habilitar este paso."*

## Registro de auditoría

Cada carga real deja un registro en la tabla de auditoría de la base (`public.etl_auditoria`). Si esa tabla no está disponible, la carga sigue igual y aparece un aviso.

## Para ver también

- [Avance FTTH](avance-ftth.md): la etapa que usa estas capas.
- [Preguntas frecuentes y problemas comunes](preguntas-frecuentes.md): permisos y errores habituales.
