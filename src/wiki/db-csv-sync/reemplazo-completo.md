---
title: "Modo Reemplazo completo"
order: 5
---

# Modo Reemplazo completo

El modo **Reemplazo completo** deja la tabla destino con **exactamente las filas del archivo CSV**: primero **vacía** la tabla y luego la **vuelve a cargar** con todo el contenido del archivo. No compara ni genera parches.

> [!WARNING]
> Es una acción **destructiva**: se eliminan **todos los registros** de la tabla destino. Tenga una copia de seguridad si esos datos importan. Si solo necesita aplicar las diferencias, use el modo **Comparar** (vea [Pasos 3 a 5: comparar y aplicar los parches](comparar.md)).

## Qué necesita

- La conexión a la base y el archivo CSV cargados (pasos 1 y 2, igual que al comparar).
- Un archivo CSV en **UTF-8**, con una fila de encabezados. La herramienta detecta sola el separador (coma, punto y coma o tabulador), ignora las líneas en blanco y admite campos entre comillas con separadores, comillas o saltos de línea adentro.
- Un usuario con permiso de `DELETE` e `INSERT` sobre la tabla destino (y `UPDATE` sobre sus secuencias si reinicia secuencias).

## Paso 3: elegir el modo

Elija **Reemplazo completo**. El recorrido pasa a tener cinco pasos: el cuarto es el mapeo de columnas y el quinto es el reemplazo.

## Paso 4: mapeo de columnas

Para **cada columna de la tabla destino** elija de qué columna del CSV sale su valor.

- Las columnas con el mismo nombre (o un nombre muy parecido) **vienen ya elegidas**; las marcadas *Auto* conviene revisarlas.
- Elija **— no mapear —** para dejar una columna sin cargar: tomará su valor por defecto de PostgreSQL.
- Las columnas **NOT NULL (requerido)** deben estar mapeadas o tener un valor definido en **Valores por Defecto para Inserciones (INSERT)**. Sin eso no se puede continuar.
- Los valores se leen como **texto** y la base los convierte al tipo de la columna destino. Una celda vacía se guarda como `NULL` en las columnas numéricas, de fecha, booleanas y geométricas, y como texto vacío en las columnas de texto.
- **Geometría**: si el CSV tiene una columna `geom`, `geometry`, `wkt` (EWKB hexadecimal o WKT) o un par de columnas de latitud y longitud, aparece la opción **Geometría del archivo**. Solo **una** columna destino puede recibirla. Solo se admiten columnas destino de geometría 2D.

## Paso 5: confirmar y ejecutar

El recuadro rojo muestra **qué tabla será vaciada** (servidor y `esquema.tabla`), cuántos registros tiene hoy y cuántas filas se cargarán. Verifique que sea la tabla correcta.

- **SRID de origen**: solo aparece si mapeó la geometría. Se aplica a la geometría WKT y a las columnas de latitud/longitud (por defecto 4326). El EWKB trae su propio SRID. La geometría se convierte al SRID de la columna destino.
- **Reiniciar secuencias del destino**: si está marcado, los contadores automáticos de las columnas que **no** reciben datos del CSV vuelven a empezar en 1 antes de la carga. Si otra tabla usa la misma secuencia, también se reinicia. Siempre se ajusta el próximo id por encima del más alto de la tabla.
- Para confirmar, escriba exactamente `esquema.tabla` (distingue mayúsculas) e ingrese la **contraseña de PostgreSQL** del destino. Luego presione **Vaciar destino y reemplazar con el CSV**.

> [!NOTE]
> Con archivos grandes (cientos de miles de filas) el reemplazo puede tardar varios minutos y **bloquea la tabla destino** mientras dura. El servidor trabaja aunque usted cambie de sección.

## Qué ocurre al ejecutar

1. Se sube el archivo al servidor y se revisa completo **antes de tocar la base**: debe ser UTF-8, tener al menos una fila de datos, y cada fila debe tener tantos campos como el encabezado (si no, se informa el número de línea).
2. Se cargan todas las filas en una tabla temporal y se comprueba que se copiaron todas. Si hay geometrías, se comprueba que todas se puedan interpretar (si no, se informa la fila).
3. En **una sola transacción** se bloquea la tabla destino, se borran todas sus filas con `DELETE` (nunca `TRUNCATE`) y se insertan las del CSV. Si la cantidad insertada no coincide, se revierte todo.
4. Se confirma la transacción, se ajustan las secuencias y se ejecuta `ANALYZE` sobre la tabla.

El panel muestra el avance: **Cargando registros** (con el conteo de filas), **Reemplazando la tabla** y **Finalizando**. Puede navegar a otra sección de la aplicación: el reemplazo sigue y el panel retoma el avance al volver. Si recarga o cierra la pestaña mientras se **sube** el archivo, la operación se cancela.

## Cómo leer el resultado

- Si algo falla **antes de confirmar** (una celda que no se puede convertir, una restricción, una geometría inválida, una pérdida de conexión), todo se revierte y el mensaje indica: *La tabla destino no fue modificada*.
- Si finaliza bien, el resumen muestra **Registros en el archivo**, **Registros cargados**, **Registros anteriores eliminados** y **Registros insertados**. Los cargados y los insertados deben coincidir.
- Se informa el próximo id de cada secuencia ajustada y si se ejecutó `ANALYZE`. Si `ANALYZE` falla es solo un aviso: el reemplazo ya se aplicó.
- **Estado desconocido**: si se pierde la conexión justo al confirmar, o durante más de un minuto sin respuesta del servidor, el panel advierte que no se sabe si el reemplazo se aplicó. **Verifique el contenido de la tabla** antes de reintentar.
- No se puede iniciar un segundo reemplazo sobre la misma tabla mientras hay uno en curso.

## Errores frecuentes

| Mensaje | Qué hacer |
|---|---|
| El archivo no está codificado en UTF-8 | Guarde el CSV como *CSV UTF-8* y vuelva a cargarlo. |
| La línea N tiene X campos y el encabezado tiene Y | Revise esa línea: falta o sobra un separador, o hay una comilla sin cerrar. |
| Columnas del CSV no encontradas | Una columna mapeada ya no está en el encabezado: vuelva a cargar el archivo y revise el mapeo. |
| La geometría de la fila N no se pudo interpretar | Esa fila tiene un EWKB o WKT inválido: corríjala en el archivo. |
| El SRID de origen no existe en spatial_ref_sys | Ingrese un SRID válido para la base. |
| Faltan columnas NOT NULL sin origen ni valor por defecto | Mapee la columna o defina un valor por defecto en el paso 4. |
