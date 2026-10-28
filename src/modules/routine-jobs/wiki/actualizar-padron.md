---
title: "Etapa 5: Actualizar padrones"
order: 6
---

# Etapa 5: Actualizar padrones

Esta etapa resuelve cada padrón de la tabla de staging contra las provincias y localidades de carto, y **rellena la tabla de trabajo** (en el uso mensual, `carto.padron_tmp_actualizacion`). Esa tabla se compara después a mano con el padrón.

No modifica `carto.padron`: solo escribe en la tabla de trabajo. La tabla de trabajo la crea usted de antemano; el trabajo no la crea ni la borra.

## Pasos

La conexión ya se pidió al entrar al trabajo. Los pasos son **Tablas**, **Opciones**, **Revisar** y **Resultado**.

### Tablas

Se eligen tres esquemas (**Esquema de origen**, **Esquema de trabajo** y **Esquema de carto**) y estas tablas:

| Campo | Qué es |
|---|---|
| **Tabla de origen** | La tabla de staging de la etapa 1 (no la original `catastro_paispadron`). |
| **Tabla de trabajo** | La tabla que se rellena. |
| **Tabla padrón** | El padrón de carto. |
| **Tabla de provincias** | Para resolver la provincia. |
| **Tabla de localidades** | Para resolver la localidad. |
| **Tabla de tipos de unidad (opcional)** | Si se indica, se usa para distinguir el tipo de localidad. |

### Opciones

- **Vaciar tabla de trabajo**: **DELETE** (predeterminado, borra fila por fila) o **TRUNCATE** (vacía de una vez; pide el privilegio TRUNCATE y bloquea la tabla hasta terminar).
- **Tipo de localidad**: valor de la columna de tipo de unidad que marca las localidades, escrito tal cual aparece en la tabla de tipos.

### Revisar

**Analizar sin cargar** hace todo y revierte: la tabla de trabajo no cambia. **Actualizar tabla de trabajo** escribe en ella y pide escribir de nuevo la contraseña y el nombre de la tabla de trabajo.

## Cómo leer el informe

Los totales son **Filas leídas**, **Filas escritas**, **Filas omitidas** y **Geometrías reparadas**. Los banners posibles son "Análisis: la tabla de trabajo no fue modificada.", "Actualización terminada: la tabla de trabajo se ha cargado.", "La actualización terminó con advertencias. Revise el informe." y "Resultado incierto: hay que verificar la tabla de trabajo antes de volver a actualizar."

## Filas omitidas

Una fila se omite, no se escribe, cuando no se puede resolver con seguridad. El informe cuenta cada motivo y muestra qué hacer:

| Motivo | Qué significa | Qué hacer |
|---|---|---|
| Clave nula | Falta el tipo de unidad (`unidadcat`), el departamento, la localidad (en urbano) o el número. | Corregir la tabla de origen. |
| Provincia no encontrada | El departamento del padrón no coincide con ningún nombre de la tabla de provincias. | Revisar el nombre o la tabla de provincias. |
| Provincia ambigua | El nombre coincide con más de una provincia. | Revisar la tabla de provincias. |
| Localidad no encontrada | La localidad no existe en su provincia. | Ver la lista de **Localidades no encontradas** y comprobar si esas localidades existen en la tabla de localidades (etapas 2 y 3). |
| Localidad ambigua | La localidad coincide con más de una en su provincia. | Revisar la tabla de localidades. |
| Sin geometría | La fila no tiene una geometría utilizable. | Corregir la geometría en la tabla de origen. |
| Clave duplicada | Varias filas comparten la misma clave y **todas se omiten**. | Revisar la tabla de origen. |

Se omiten todas las filas con clave duplicada porque quedarse con una sola sería arbitrario: no hay forma de saber cuál es la correcta. Por eso la etapa 1 unifica las claves duplicadas, y por eso esta etapa debe leer la tabla de staging.

El informe agrupa los omitidos por departamento y por localidad, y lista las **Localidades no encontradas** y **Localidades ambiguas** (hasta 20), además de ejemplos de filas omitidas y claves que chocan.

El botón **Descargar CSV** se explica en [Descargar el informe](descargar-informe.md).
