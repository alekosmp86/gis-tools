---
title: "Preguntas frecuentes y problemas comunes"
order: 6
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

La carga de geometrías también necesita que la base tenga **PostGIS** instalado.

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

## En general

### ¿Se guarda mi contraseña?

No. Se mantiene solo en memoria mientras la página está abierta. Los perfiles guardan servidor, puerto, base y usuario, pero nunca la contraseña.

### ¿Puedo deshacer una carga?

No desde la herramienta. En Indicadores LTE, volver a cargar el archivo correcto de la misma fecha restaura el corte. En Cargas SHP, la tabla queda con el contenido del archivo cargado. Si los datos son importantes, tenga una copia de seguridad antes de cargar.
