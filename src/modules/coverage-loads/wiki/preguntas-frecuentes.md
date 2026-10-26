---
title: "Preguntas frecuentes y problemas comunes"
order: 8
---

# Preguntas frecuentes y problemas comunes

## Permisos

Antes de escribir, la herramienta comprueba que el usuario tenga los permisos necesarios. Si falta alguno lo informa en la revisión y **no deja cargar**. Los permisos que hacen falta son:

| Etapa | Tabla | Permisos |
|---|---|---|
| **Indicadores LTE** | `historico.h_cobertura_lte_localidad` (histórico) | `SELECT`, `INSERT`, `DELETE` |
| **Indicadores LTE** | `public.indicadores_lte` (tabla de trabajo) | `SELECT`, `INSERT`, `DELETE` |
| **Cargas SHP** | la tabla de destino (`public.lte`, `public.wcdma`, `public.nbiot` o `public.cobertura5g`) | `SELECT`, `INSERT`, `DELETE` |
| **Cargas SHP** | esquema `public` | `CREATE` (para las tablas de trabajo) |
| **Capas SIGRA** | cada tabla de capa (por ejemplo `public.area_zonas_ftth_f` o `public.limite_central_ftth`) | `SELECT`, `INSERT`, `DELETE` y `USAGE` sobre su secuencia |
| **Capas SIGRA** | la base de datos | `TEMP` (para la tabla temporal de cada capa) |
| **Capas SIGRA** | `public.etl_auditoria` (opcional) | `SELECT`, `INSERT` y `UPDATE`. Sin ella la carga sigue, con un aviso |
| **Avance FTTH** | `public.avance_planilla_int` y `public.avance_planilla_mvd` (planillas) | `SELECT`, `INSERT`, `DELETE` y `USAGE` sobre su secuencia |
| **Avance FTTH** | `public.avance_uruguay_planilla` (Avance) | `SELECT`, `INSERT`, `UPDATE`, `DELETE` y `USAGE` sobre su secuencia |
| **Avance FTTH** | `historico.h_avance_uruguay` (historial) | `SELECT`, `INSERT` y `USAGE` sobre su secuencia |
| **Avance FTTH** | `public.area_zonas_ftth_f` y `public.limite_central_ftth` | `SELECT` |

La carga de geometrías, la de capas SIGRA y el Avance FTTH también necesitan que la base tenga **PostGIS** instalado.

### Falta el privilegio DELETE (Indicadores LTE)

El histórico se actualiza **reemplazando el corte**, y eso requiere `DELETE`. Puede no estar otorgado. Pida al administrador de la base de datos que ejecute:

```sql
GRANT DELETE ON historico.h_cobertura_lte_localidad TO <usuario>;
```

### Falta el privilegio DELETE (Cargas SHP)

Reemplazar la tabla de destino requiere `DELETE` sobre ella. Pídalo al administrador:

```sql
GRANT DELETE ON public.lte TO <usuario>;
```

(cambie `lte` por la tabla que corresponda).

### Nota: reemplazar datos deja filas muertas

Las cargas reemplazan los datos con `DELETE` (no se vacía la tabla de golpe), así que quedan filas muertas hasta que el administrador ejecute el `VACUUM`. Mientras tanto otras personas pueden seguir consultando; solo otras cargas esperan su turno.

## Indicadores LTE

### El archivo se rechaza antes de revisar

Revise el nombre: debe ser exactamente `IndicadoresLTE_aaaammdd.csv`, respetando las mayúsculas y minúsculas del prefijo, con la extensión `.csv` en minúscula y una fecha real. También se rechaza un archivo vacío, de más de 10 MB, sin ninguna fila válida, o dos archivos con la misma fecha en la misma carga.

### Hay filas rechazadas

Los problemas por fila **no impiden la carga**: se guardan las filas válidas y se listan las rechazadas con la línea y el motivo. Descargue la lista con **Descargar filas rechazadas (CSV)**, corrija el archivo y vuelva a cargarlo: el corte se reemplaza y no se duplican filas.

### Los acentos se ven mal

El archivo debe estar en **ISO-8859-1** (latin1). Si lo guardó en UTF-8, los acentos y la `ñ` se leerán mal. Guárdelo de nuevo como ISO-8859-1.

### "El corte se reduce" y no me deja cargar

Las filas válidas del archivo son menos que las que hoy tiene el histórico para esa fecha. Revise que el archivo no esté incompleto. Si es correcto, marque la casilla de confirmación para continuar.

### Cargué el archivo equivocado

La herramienta **reemplaza el corte** de la fecha que trae el archivo. Si cargó un archivo equivocado para una fecha, vuelva a cargar el archivo correcto de esa misma fecha: el corte se restaura sin duplicados.

### "Otra carga está en curso" o "La operación excedió el tiempo máximo"

- *Otra carga está en curso, intente de nuevo en unos segundos*: alguien más está cargando en ese momento. Espere un momento y reintente.
- *La operación excedió el tiempo máximo*: la operación tardó demasiado y se canceló. No se modificó nada: puede reintentar.

## Cargas SHP

### No puedo iniciar la carga

Revise la lista de verificaciones del plan: un **bloqueo**, un **privilegio faltante**, la falta de **PostGIS** o de la tabla de destino impiden iniciar. Resuelva la causa y presione **Revisar de nuevo**. Vea [Etapa Cargas SHP](cargas-geometrias.md).

### La carga falló por las verificaciones de calidad

Las geometrías del archivo no pasaron los controles (por ejemplo, quedaron piezas inválidas tras la reparación, o el área cambió demasiado). La tabla **no se modificó**. Revise el archivo de origen y use el modo **Prueba** para validar una versión corregida antes de hacer la carga real.

### La carga se interrumpió o aparece como detenida

Si el servidor se reinició o el proceso murió, la carga se marca como fallida. Si fallaba durante el reemplazo final, la operación se revierte y la tabla queda como estaba. Descarte el registro e inicie una **Nueva carga**.

### Cerré la pestaña, ¿se perdió la carga?

No. La carga corre en el servidor. Al volver a abrir la herramienta y confirmar la conexión, la etapa retoma la carga en curso.

### Sube un archivo muy grande y se corta

El límite es de 4 GB, y el servidor necesita espacio libre en disco. Si falla la subida por tamaño o espacio, la herramienta lo informa. Pruebe con un archivo más chico o consulte con el administrador del servidor.

### Mis geometrías no coinciden con las de la tabla

La herramienta asume que el archivo está en **EPSG:32721** y no reproyecta. Si está en otro sistema de coordenadas, conviértalo antes de cargarlo y compruébelo con el modo **Prueba**.

## Capas SIGRA

### "Faltan privilegios sobre ..." o "La tabla ... no existe"

La capa no se puede cargar hasta que se resuelva el motivo que aparece debajo de su nombre. Si falta un privilegio, pídalo al administrador de la base. Por ejemplo:

```sql
GRANT DELETE ON public.area_zonas_ftth_f TO <usuario>;
```

Si la tabla no existe, debe crearla un administrador antes de cargar esa capa.

### "La base de datos no permite crear tablas temporales (falta el privilegio TEMP)"

La carga usa una tabla temporal por capa. Pida al administrador:

```sql
GRANT TEMP ON DATABASE <base> TO <usuario>;
```

### "No se pudo consultar el WFS de SIGRA"

El servidor no pudo consultar SIGRA. Puede ser un problema temporal: espere un momento y presione **Actualizar estado**. Si sigue igual, avise al administrador de la red.

### Una capa quedó "Rechazada por validación"

SIGRA publicó menos del 97 % de los registros que tiene la tabla. La tabla **no se modificó**. Revise si SIGRA tuvo un cambio grande (un corte del servicio, por ejemplo) y repita con **Probar sin guardar** más tarde. La herramienta no permite forzar la carga de una capa rechazada.

### Hay repetidos en "Repetidos descartados"

Son registros de SIGRA con un identificador que ya llegó en la misma descarga. Se descarta el repetido, como hacía el proceso anterior. No es un error.

### "Con error" en el paso *Descarga SIGRA* o *Inserción*

En *Descarga SIGRA* el problema suele estar en la conexión con SIGRA: reintente. En *Inserción* suele pasar que los datos recibidos no encajan con la tabla de destino: avise al equipo que mantiene la herramienta, indicando la capa y el mensaje del resultado. En ambos casos la tabla no queda a medias.

## Avance FTTH

### "Complete primero Capas SIGRA para habilitar este paso"

La etapa Avance FTTH necesita que las capas obligatorias estén cargadas en una **carga real** (una prueba no cuenta). Complete primero la etapa [Capas SIGRA](capas-sigra.md).

### "La capa de zonas ... está vacía"

No hay zonas con qué cruzar las planillas. Cargue primero las capas SIGRA y vuelva a revisar el plan.

### El archivo se rechaza por el nombre

Los nombres válidos son `SituacionFTTH_INT_ddmmaaaa.csv` (Interior) y `SituacionFTTH_UDPEM_ddmmaaaa.csv` (Montevideo), con una fecha real. Debe haber **exactamente uno** de cada tipo.

### "Los archivos tienen fechas distintas"

Las dos planillas deben ser del mismo día. Busque la versión que falta o la que quedó vieja.

### "... no tiene ninguna fila válida"

Todas las filas del archivo se rechazaron. Revise el separador (`;`), la codificación (ISO-8859-1) y que tenga 10 columnas. Descargue la lista de filas rechazadas para ver el motivo de cada una.

### "El archivo supera el tamaño máximo"

Cada planilla puede pesar hasta 10 MB. Si la planilla es más grande, consulte al equipo que mantiene la herramienta.

### "... quedarían N filas en la planilla y hoy hay M"

Es una advertencia: la planilla nueva tiene menos filas que la actual. Revise que el archivo no esté incompleto. Si es correcto, siga adelante.

### "La planilla ... quedó con N filas y se esperaban M; se deshizo la carga"

La verificación final encontró una diferencia y **nada se guardó**. Reintente con la misma planilla. Si vuelve a pasar, avise al equipo que mantiene la herramienta.

### "El Avance actual ya fue cargado hoy: no se copia al historial"

Es un aviso, no un error. Si ya se cargó el Avance en el día, la segunda carga no copia la versión de hoy al historial, para no archivarla dos veces.

### Un reporte aparece como "Falló"

Los otros reportes se generaron igual. Los reportes leen el estado actual de la base: puede volver a descargarlos desde la sección **Reportes del Avance FTTH** del paso Resultado.

### "¿La prueba deja algo guardado?"

No. Pero las pruebas usan números de secuencia (los identificadores de cada fila), así que la numeración de las tablas puede tener saltos después de una prueba. Es normal.

## En general

### ¿Se guarda mi contraseña?

No. Se mantiene solo en memoria mientras la página está abierta. Los perfiles guardan servidor, puerto, base y usuario, pero nunca la contraseña.

### ¿Puedo deshacer una carga?

No desde la herramienta. En Indicadores LTE, volver a cargar el archivo correcto de la misma fecha restaura el corte. En Cargas SHP, la tabla queda con el contenido del archivo cargado. En Capas SIGRA, la tabla queda con lo que publica SIGRA. En Avance FTTH, el Avance anterior queda en el historial, salvo en una segunda carga del mismo día. Si los datos son importantes, tenga una copia de seguridad antes de cargar.
