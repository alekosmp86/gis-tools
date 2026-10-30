---
title: "Descargar el informe"
order: 7
---

# Descargar el informe

Cada informe de etapa tiene un botón **Descargar CSV**. Genera un archivo con los cambios que se hicieron en la base, para guardarlo como **historial del mes** o revisarlo en una planilla.

## Nombre del archivo

```
carto-<etapa>-<simulacion|real>-AAAAMMDD-HHmmss.csv
```

| Parte | Valores |
|---|---|
| `<etapa>` | `cargar-padrones`, `cargar-localidades`, `unidad-territorial`, `completar-unidad-territorial` o `actualizar-padron` |
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

### Completar unidades territoriales

Una fila por cambio, con estas columnas: **Tabla**, **Cambio**, **Provincia**, **Nombre**, **Id** e **Id dirección maestra**.

| Valor de Cambio | Significado |
|---|---|
| Dirección maestra creada | Se creó un registro en la tabla de direcciones maestras. **Id** es el id de la unidad. |
| Unidad enlazada | Se escribió el id de la dirección maestra en la unidad. **Id** es el id de la unidad. |

Una unidad nueva genera dos filas (la creada y la enlazada); una que ya tenía registro, solo la enlazada. Solo se exportan las filas que el informe lista, es decir, **hasta 500** unidades.

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
