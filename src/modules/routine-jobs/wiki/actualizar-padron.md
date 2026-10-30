---
title: "Etapa 5: Actualizar padrones"
order: 6
---

# Etapa 5: Actualizar padrones

Esta etapa toma cada padrón de la tabla de origen (la de la etapa 1), lo resuelve contra las provincias y localidades de carto y lo lleva a la **tabla de destino** que usted elige:

- los padrones nuevos se **insertan**, y reciben su id de la secuencia de la tabla;
- los padrones que ya existen y cuya geometría cambió se **actualizan**: solo cambia la geometría, y solo si la opción **Actualizar geometrías** está activada;
- **nada se borra ni se renumera**. Los padrones que están en la tabla de destino pero ya no aparecen en el origen se cuentan y se listan, nunca se tocan.

## Pasos

La conexión ya se pidió al entrar al trabajo. Los pasos son **Tablas**, **Opciones**, **Revisar** y **Resultado**.

### Tablas

Las tablas vienen preelegidas (`bdj_carto.paispadron` como origen y `carto.padron`, `carto.province`, `carto.territorial_unit` y `carto.territorial_unit_type` en carto); puede cambiarlas.

Se eligen dos esquemas y estas tablas. El **Esquema de origen** contiene la tabla de origen. El **Esquema de carto** contiene la tabla de destino, las provincias, las localidades y, si se elige, los tipos de unidad.

| Campo | Qué es |
|---|---|
| **Tabla de origen** | La tabla de staging de la etapa 1 (no la original `catastro_paispadron`). |
| **Tabla de destino** | La tabla que recibe los datos: inserta los padrones nuevos y actualiza las geometrías cambiadas. Nunca borra filas ni cambia ids. |
| **Tabla de provincias** | Para resolver la provincia. |
| **Tabla de localidades** | Para resolver la localidad. Debe ser `territorial_unit`: los padrones guardan ids de unidades territoriales, no de localidades catastrales. |
| **Tabla de tipos de unidad (opcional)** | Si se indica, se usa para distinguir el tipo de localidad. |
| **Tabla de direcciones maestras** | Solo aparece con la opción de abajo activada. Debe ser distinta de la tabla de destino. |

**Cómo probar sin tocar carto.padron**: elija como **Tabla de destino** una tabla de prueba, por ejemplo `padron_tmp_actualizacion`. Como esta etapa nunca borra filas ni cambia ids, la misma tabla puede usarse después como `carto.padron` cuando usted lo decida, con el análisis ya revisado.

### Opciones

- **Tipo de localidad**: valor de la columna de tipo de unidad que marca las localidades, escrito tal cual aparece en la tabla de tipos. Solo aparece si eligió una tabla de tipos.
- **Tolerancia (m)**: distancia de Hausdorff en metros por debajo de la cual una geometría se considera sin cambios. Predeterminado: 1,0 m.
- **Actualizar geometrías**: si está activada, la geometría de los padrones existentes se reemplaza por la del catastro cuando cambió más allá de la tolerancia. Predeterminado: activada. Con la opción desactivada, el análisis lista esos cambios como "detectados" pero no los aplica.

### Enlazar direcciones maestras de los padrones (opcional)

Es una casilla del paso **Tablas**, desactivada por defecto. Con ella activada, después de insertar y actualizar, la etapa crea la dirección maestra de cada padrón de la tabla de destino que todavía no la tiene y escribe su id en el padrón. El URN de cada registro es `cgeo:padron:id:` seguido del id del padrón, y el registro se crea con latitud 0 y longitud 0.

- Si ya hay exactamente un registro con ese URN, el padrón solo se enlaza con él.
- Si hay dos o más, el padrón es **ambiguo**: no se crea ni se enlaza nada, y el informe lo lista.
- El id del padrón y su geometría nunca cambian. Todo ocurre en la misma transacción que la carga: si algo no coincide, se revierte todo.

**Por qué viene desactivada**: crear direcciones maestras es una escritura en otra tabla, y no todas las cargas la necesitan. Actívela cuando los padrones de esta carga deben tener su dirección maestra; si no, la etapa 4 puede hacerlo aparte.

**Advertencia**: con esta opción se crean direcciones maestras reales para los ids de la tabla de destino. Si la tabla de destino no se llama `padron`, **Revisar** muestra una advertencia destacada: antes de cargar, confirme que esa es la tabla que quiere enlazar.

### Revisar

**Analizar sin cargar** hace todo y revierte: la tabla de destino no cambia, pero la secuencia de ids sí avanza. Por eso los ids de la siguiente carga real pueden tener saltos. **Actualizar padrones** escribe en la tabla de destino y pide escribir de nuevo la contraseña y el nombre de la tabla de destino.

## Cómo se clasifica cada padrón

Cada padrón del origen se busca en la tabla de destino por su clave: tipo de padrón, provincia, localidad (vacía en rural) y número.

| Clase | Qué significa | Qué hace la carga real |
|---|---|---|
| Insertada | No hay ningún padrón con esa clave en el destino. | Lo inserta, con un id nuevo de la secuencia. |
| Sin cambios | Existe una fila y su geometría es igual. | Nada. |
| Sin cambios dentro de tolerancia | Existe una fila y su geometría difiere, pero la distancia es menor o igual a la tolerancia. | Nada. |
| Geometría que cambia | Existe una fila y la distancia supera la tolerancia. | Reemplaza la geometría si **Actualizar geometrías** está activada. Si no, solo lo informa. |
| Ambigua | Hay más de una fila con esa clave en el destino. | Nada: no se adivina cuál es la correcta. Se informa. |
| Faltante en destino | Hay una fila en el destino cuya clave no tiene padrón utilizable en el origen. | Nada: se cuenta y se muestra. Nunca se borra. |

Un padrón del origen que se omitió (ver **Filas omitidas**) no tiene clase: no se inserta ni cambia nada.

## Padrones reclasificados o renumerados

Un padrón que cambió de tipo (rural o urbano), de localidad o de número, pero que sigue ocupando la misma forma en el mapa, no es un padrón nuevo. La carga lo empareja con la fila antigua y actualiza esa fila en su lugar: su id y su dirección maestra se conservan y nunca se renumera ninguna fila.

Un par se aplica cuando el padrón nuevo y la fila antigua están en la misma provincia, la forma nueva cubre casi por completo a la antigua, las áreas difieren como mucho en un 2 %, cada uno tiene una sola pareja. La tolerancia no decide si un par se aplica: la distancia entre las formas se muestra solo como información. Si el número cambia, solo cambia en un par aplicado.

Los pares que no se aplican no cambian nada: el padrón nuevo se inserta y la fila antigua se lista como faltante. Son **ambiguos** (una de las dos filas tiene más de una pareja).

En el informe, la sección **Padrones reclasificados o renumerados** muestra cada par con su estado: **Aplicado** o **No aplicado: ambiguo**. Los pares aplicados aparecen en el CSV de cambios como **Clave actualizada**; los no aplicados, en el CSV de inconsistencias.

## Cómo leer el informe

Las tarjetas de arriba muestran **Filas leídas**, **Candidatas** (las que no se omitieron), **Omitidas**, **Insertadas**, **Actualizadas** y **Geometrías que cambian**. **Claves actualizadas** cuenta los padrones reclasificados o renumerados que se actualizan en su lugar.

Los banners posibles son "Análisis: la tabla de destino no fue modificada.", "Actualización confirmada: la tabla de destino fue modificada.", "La actualización terminó con advertencias. Revise el informe." y "Resultado incierto: hay que verificar la tabla de destino antes de volver a actualizar."

La sección de la tabla de destino trae los contadores de cada clase y listas desplegables:

- **Padrones insertados**, con su id nuevo;
- **Geometrías que cambian**, con la distancia en metros y la proporción del área que cambió;
- **Padrones reclasificados o renumerados**, con el estado de cada par;
- **Faltantes en destino** y **Ambiguas**, con muestras de clave.

Las listas muestran hasta 500 filas (las muestras, hasta 20). Cuando una lista se corta, su título dice "primeras N de M".

Si la opción de direcciones maestras está activada, aparece además una sección con la tabla de direcciones maestras: padrones sin dirección maestra, registros por crear y creados, padrones enlazados, los que ya tenían registro, los ambiguos y los que quedan sin dirección maestra después del enlace. Sus listas siguen las mismas reglas de corte.

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
