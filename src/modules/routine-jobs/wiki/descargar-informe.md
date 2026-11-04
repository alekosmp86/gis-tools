---
title: "Descargar el informe"
order: 6
---

# Descargar el informe

Cada informe de etapa tiene un botón **Descargar CSV**. Genera un archivo con los cambios que se hicieron en la base, para guardarlo como **historial del mes** o revisarlo en una planilla.

## Nombre del archivo

```
carto-<etapa>-<simulacion|real>-AAAAMMDD-HHmmss.csv
```

| Parte | Valores |
|---|---|
| `<etapa>` | `cargar-padrones`, `cargar-localidades`, `unidad-territorial` o `actualizar-padron` |
| `simulacion` o `real` | `simulacion` si el informe viene de **Analizar sin cargar**; `real` si viene de una carga real |
| `AAAAMMDD-HHmmss` | Fecha y hora en que se descargó, por ejemplo `20261028-143005` |

Ejemplo: `carto-cargar-localidades-simulacion-20261028-143005.csv`.

El archivo de inconsistencias usa el mismo nombre con `inconsistencias` antes de la fecha: `carto-<etapa>-<simulacion|real>-inconsistencias-AAAAMMDD-HHmmss.csv`.

## Qué contiene

**Solo se exportan los cambios en la base de datos.** Las filas omitidas, los faltantes, las muestras y las advertencias no van en el CSV de cambios; las inconsistencias tienen su propio archivo (ver más abajo).

### Cargar localidades y Unidades territoriales

Una fila por cambio, con estas columnas:

| Columna | Contenido |
|---|---|
| Tabla | La tabla destino donde ocurre el cambio. |
| Cambio | Ver la tabla de abajo. |
| Provincia | En localidades, el departamento. En unidades territoriales, el id de la provincia. |
| Nombre | Nombre de la localidad o de la unidad. |
| Id | El id asignado, solo en las filas **Insertada**. |
| Distancia (m) | Distancia entre la geometría anterior y la nueva, en los cambios de geometría y en las claves actualizadas (solo informativa en estas últimas). |
| Relación de área | Proporción del área que cambió, solo en los cambios de geometría. |

Valores de **Cambio**:

| Valor | Significado |
|---|---|
| Insertada | La fila es nueva y se insertó en la tabla. |
| Geometría modificada | La geometría cambió y se reemplazó (con **Actualizar geometrías** activada). |
| Geometría detectada (no aplicada) | La geometría cambió, pero no se reemplazó porque **Actualizar geometrías** estaba desactivada. |

Las filas están ordenadas: primero las insertadas, después los cambios de geometría, y dentro de cada grupo por provincia y nombre. Solo se exportan las filas que el informe lista, es decir, **hasta 500** insertadas y 500 cambios de geometría por tabla.

Con la opción de direcciones maestras de **Actualizar unidades territoriales** activada, el archivo agrega la columna **Id dirección maestra** (vacía en las filas de cambio de unidades) y dos clases de filas: **Dirección maestra creada** (en la tabla de direcciones maestras, **Id** es el id de la unidad) y **Unidad enlazada** (en la tabla de unidades, con el id de su dirección maestra). Una unidad nueva genera ambas; una que ya tenía registro, solo la enlazada. Las listas se cortan en 500, con una fila de aviso por cada lista cortada.

### Cargar padrones

Un resumen de dos columnas: **Cambio** y **Cantidad**, con los padrones rurales insertados, los urbanos insertados y el total.

### Actualizar padrones

Una fila por cambio, con estas columnas: **Tabla**, **Cambio**, **Tipo**, **Provincia**, **Localidad**, **Padrón**, **Distancia (m)**, **Relación de área**, **Id**, **Tipo anterior**, **Localidad anterior** y **Padrón anterior** (estas tres solo se llenan en las filas `Clave actualizada`). La columna **Id** queda vacía en las filas de padrones insertados y de cambios de geometría; solo las filas de direcciones maestras la llenan.

| Valor de Cambio | Significado |
|---|---|
| Insertada | El padrón es nuevo y se insertó en la tabla de destino, con un id nuevo. |
| Geometría modificada | La geometría cambió y se reemplazó (con **Actualizar geometrías** activada). |
| Geometría detectada (no aplicada) | La geometría cambió, pero no se reemplazó porque **Actualizar geometrías** estaba desactivada. |
| Clave actualizada | El padrón era otro (de otro tipo, localidad o número) con la misma forma: su fila se actualizó en su lugar. Las columnas **Tipo**, **Provincia**, **Localidad** y **Padrón** son las nuevas; **Tipo anterior**, **Localidad anterior** y **Padrón anterior** guardan la clave antigua. |

**Tipo** es `RURAL` o `URBANO`. **Provincia**, **Localidad** y **Padrón** son los nombres y el número del padrón en la tabla de origen; la localidad queda vacía en los rurales. Las filas están ordenadas: primero las insertadas, después los cambios de geometría, y dentro de cada grupo por provincia, localidad y padrón. Solo se exportan las filas que el informe lista, es decir, **hasta 500** padrones insertados y 500 cambios de geometría.

Si la opción **Enlazar direcciones maestras de los padrones** está activada, el CSV tiene además estas filas, con el id del padrón en **Id**:

| Cambio | Tabla | Qué significa |
|---|---|---|
| Dirección maestra creada para padrón | La tabla de direcciones maestras | Se creó un registro en la tabla de direcciones maestras para ese padrón. |
| Padrón enlazado | La tabla de destino | Se escribió el id de la dirección maestra en el padrón. |

Un padrón nuevo genera dos filas (la creada y la enlazada); uno que ya tenía registro, solo la enlazada. Solo se exportan las filas que el informe lista: **hasta 500** de cada una.

Si una lista del informe se corta en 500 filas, el CSV termina con una fila que lo avisa: en la columna **Tabla** va la tabla y en **Cambio** un texto como `Lista incompleta: se muestran las primeras 500 de 730 unidades enlazadas`. Así no queda nada oculto. Las demás columnas de esa fila quedan vacías.

## Otros CSV de Actualizar padrones

Además del CSV de cambios y el de inconsistencias, el informe de **Actualizar padrones** puede ofrecer estos botones. Usan el mismo nombre con una palabra antes de la fecha.

| Botón | Nombre | Contenido |
|---|---|---|
| **Descargar padrones faltantes** | `carto-actualizar-padron-<simulacion\|real>-faltantes-AAAAMMDD-HHmmss.csv` | Los padrones que ya no están en el catastro: Clase, Tipo, Departamento, Localidad, Padrón, Id actual, Área (m²), Cubierto (%), Reemplazado por, Referencias, Latitud y Longitud. Si la lista se corta, termina con una fila `Lista incompleta: se muestran las primeras N de M padrones faltantes`. |
| **Descargar geometrías pendientes (CSV)** | `...-geometrias-pendientes-...` | Todas las geometrías pendientes del análisis, de mayor a menor cambio de área. Ver [Etapa 4: Actualizar padrones](actualizar-padron.md). |
| **Descargar localidades no encontradas (CSV)** | `...-localidades-no-encontradas-...` | Ver abajo. |

### Descargar localidades no encontradas (CSV)

Una fila por cada localidad de la lista **Localidades no encontradas** del informe (hasta 20), con estas columnas:

| Columna | Contenido |
|---|---|
| Departamento | El departamento de la fila de origen. |
| Localidad | La localidad que no se encontró. |
| Padrones afectados | Cuántos padrones de origen se omitieron por esa localidad. |
| Motivo | Si existe una localidad con ese nombre en otros departamentos: `No existe en <departamento>; existe en <D1>, <D2>. Revise el código de departamento.` (hasta 5 departamentos). Si no existe en ningún otro: `La localidad no existe en el departamento.` |

El aviso de "Revise el código de departamento" suele indicar un código de departamento equivocado en el archivo de origen. Si la lista llega al tope de 20, el CSV termina con la fila `Lista incompleta: se muestran las primeras 20 localidades no encontradas` (el informe no guarda el total). El botón no aparece si la lista está vacía. El CSV no lista los números de padrón.

## Respaldo para revertir (no es un CSV)

Una actualización real de **Actualizar padrones** también genera un archivo `padron-revert-<esquema>-<tabla>-AAAAMMDD-HHmmss.sql.gz` para deshacer esa carga. Se descarga solo al terminar y se describe en [Etapa 4: Actualizar padrones](actualizar-padron.md).

El archivo es SQL y corre en una sola transacción (`BEGIN` ... `COMMIT`). Cubre estas clases de filas, y la cabecera del archivo cuenta cuántas hay de cada una:

| Clase | Qué deshace |
|---|---|
| Geometrías actualizadas | Devuelve la geometría anterior. |
| Padrones reclasificados | Devuelve el tipo, la localidad, el número y la geometría anteriores. |
| Padrones insertados | Los borra (los ids consecutivos se agrupan en un solo rango). |
| Padrones sin dirección maestra antes del enlace | Quita el enlace y borra solo las direcciones maestras creadas por esa ejecución. |
| Padrones eliminados | Los vuelve a insertar completos, con su id original. |
| Direcciones maestras eliminadas | Vuelven a insertarse con su id original. |
| Direcciones reasignadas | Devuelven a cada fila de otra tabla el `id_padron` del padrón subdividido. |

Orden en que corre el script: primero se deshacen los enlaces y las inserciones, luego se restauran las claves y las geometrías, después las direcciones maestras eliminadas, luego los padrones eliminados y al final las direcciones reasignadas. Las direcciones maestras van antes que los padrones y las direcciones reasignadas después, porque unas y otras dependen de esos registros. Si el archivo no tiene filas de una clase, esa parte no aparece. Las secuencias de id no se revierten.

## Descargar inconsistencias

Los informes de **Cargar padrones**, **Cargar localidades** y **Actualizar padrones** muestran un segundo botón, **Descargar inconsistencias**, solo cuando hay datos de origen que revisar. Ese archivo no contiene cambios en la base: lista los datos que el proceso no pudo usar.

### Cargar padrones

Una fila por cada par departamento y código de localidad que aparece con nombres distintos en la fuente urbana.

| Columna | Contenido |
|---|---|
| Departamento | El nombre del departamento. Si falta, el código. |
| Código de localidad | El código de localidad ambiguo. |
| Nombres | Los nombres distintos de esa localidad, separados por ` / `. |

### Cargar localidades

Una fila por cada padrón urbano que no tiene localidad en el origen (mismo departamento y mismo nombre).

| Columna | Contenido |
|---|---|
| Departamento | El departamento del padrón. Si falta, `sin dato`. |
| Localidad | La localidad del padrón. Si falta, `sin dato`. |
| Padrón | El número de padrón. Si falta, `sin dato`. |

### Actualizar padrones

Una fila por cada fila de origen omitida, y una fila por cada padrón nuevo de un posible par no aplicado (un padrón nuevo con la forma de una fila antigua que no se actualizó; ver **Padrones reclasificados o renumerados**). Si ese padrón nuevo se parece a varias filas antiguas, aparece una sola vez. En los pares, **Motivo** es `Posible par no aplicado (ambiguo)`, y las demás columnas son las del padrón nuevo.

| Columna | Contenido |
|---|---|
| Motivo | Por qué se omitió: `Provincia no encontrada`, `Provincia ambigua`, `Localidad no encontrada`, `Localidad ambigua`, `Clave nula`, `Sin geometría` o `Clave duplicada`. |
| Departamento | El departamento de la fila de origen. |
| Localidad | La localidad de la fila de origen. |
| Padrón | El número de padrón de la fila de origen. |

Las filas están ordenadas por motivo, departamento, localidad y padrón. Los valores vacíos aparecen como `sin dato`.

### Límite de filas

Cada archivo tiene **hasta 500** filas. Si hay más, la última fila indica cuántas hay en total, por ejemplo `Lista incompleta: se muestran las primeras 500 de 730 filas omitidas`. El total real aparece también en el informe.

## Abrirlo en Excel

El archivo está en UTF-8 y separado por comas. Excel lo abre con doble clic y respeta los acentos.

Si todas las columnas aparecen juntas en una sola, el separador de listas de Excel no es la coma. Hay dos soluciones: cambiar el **separador de listas** en la configuración regional de Windows, o abrir Excel y usar **Datos > Desde texto/CSV**, donde se elige la coma como delimitador.

## Cómo usarlo como historial

Después de cada carga real, descargue el CSV de cada etapa y guárdelo en una carpeta del mes. El nombre ya incluye la etapa, si fue simulación o real, y la fecha y hora. Un CSV de simulación sirve para revisar con tiempo lo que se va a cambiar antes de hacer la carga real.
