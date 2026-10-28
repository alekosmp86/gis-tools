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

## Qué contiene

**Solo se exportan los cambios en la base de datos.** Las filas omitidas, los faltantes, las muestras y las advertencias no van en el CSV.

### Cargar localidades y Unidades territoriales

Una fila por cambio, con estas columnas:

| Columna | Contenido |
|---|---|
| Tabla | La tabla destino donde ocurre el cambio. |
| Cambio | Ver la tabla de abajo. |
| Provincia | En localidades, el departamento. En unidades territoriales, el id de la provincia. |
| Nombre | Nombre de la localidad o de la unidad. |
| Id | El id asignado, solo en las filas **Insertada**. |
| Distancia (m) | Distancia entre la geometría anterior y la nueva, solo en los cambios de geometría. |
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

### Cargar padrones y Actualizar padrones

Un resumen de dos columnas: **Cambio** y **Cantidad**.

| Etapa | Filas del CSV |
|---|---|
| Cargar padrones | Padrones rurales insertados, Padrones urbanos insertados, Total insertados |
| Actualizar padrones | Filas escritas |

Si una lista del informe se corta en 500 filas, el CSV termina con una fila que lo avisa: en la columna **Tabla** va la tabla y en **Cambio** un texto como `Lista incompleta: se muestran las primeras 500 de 730 unidades enlazadas`. Así no queda nada oculto. Las demás columnas de esa fila quedan vacías.

## Abrirlo en Excel

El archivo está en UTF-8 y separado por comas. Excel lo abre con doble clic y respeta los acentos.

Si todas las columnas aparecen juntas en una sola, el separador de listas de Excel no es la coma. Hay dos soluciones: cambiar el **separador de listas** en la configuración regional de Windows, o abrir Excel y usar **Datos > Desde texto/CSV**, donde se elige la coma como delimitador.

## Cómo usarlo como historial

Después de cada carga real, descargue el CSV de cada etapa y guárdelo en una carpeta del mes. El nombre ya incluye la etapa, si fue simulación o real, y la fecha y hora. Un CSV de simulación sirve para revisar con tiempo lo que se va a cambiar antes de hacer la carga real.
