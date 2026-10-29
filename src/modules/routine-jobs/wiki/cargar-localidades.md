---
title: "Etapa 2: Cargar localidades"
order: 3
---

# Etapa 2: Cargar localidades

Esta etapa inserta las localidades nuevas y actualiza las geometrías de las que cambiaron, en una o dos tablas de localidades de destino.

## De dónde salen los datos

En el paso **Tablas** se eligen tres tablas de origen:

| Campo | Para qué se usa |
|---|---|
| **Tabla de padrones** (padrones urbanos cargados) | Solo para saber qué localidades existen. Debe ser la **tabla de staging** de la etapa 1, no la original. |
| **Tabla de localidades de origen** | Aporta el nombre, el departamento y la geometría de cada localidad. |
| **Tabla de provincias** | Asocia cada departamento con su provincia. |

Las tablas de origen se proponen con lo que eligió en la etapa 1.

## Los destinos

En **Destinos** hay dos bloques, uno al lado del otro: **Localidades en bdj_carto** y **Localidades en carto**. Cada uno tiene su esquema y su tabla, y la casilla **Incluir este destino**. Elija al menos uno. Todos los destinos incluidos reciben la misma carga, en la misma transacción: si algo falla, ninguno cambia.

## Localidades nuevas y cambiadas

Cada localidad del origen se compara con el destino por **provincia y nombre**:

- **Nueva**: no existe en el destino. Se inserta, y su id sale de la secuencia de la tabla.
- **Cambiada**: existe, pero su geometría es distinta y la diferencia supera la **tolerancia**. Se reemplaza la geometría.
- **Sin cambios**: la geometría es igual, o la diferencia está dentro de la tolerancia.
- **Ambigua**: el destino tiene varias filas con esa provincia y nombre. No se inserta ni se actualiza.
- **Faltante en origen**: está en el destino pero no en el origen. Solo se informa, nunca se borra.

De una localidad existente solo cambia la geometría: el id, el código, el nombre, la fuente y la provincia no se tocan.

## Opciones

- **Tolerancia (m)**: distancia de Hausdorff, en metros, por debajo de la cual una geometría se considera sin cambios. Predeterminado: 1,0 m.
- **Actualizar geometrías**: activada por defecto. Si se desactiva, las localidades nuevas se insertan igual, pero las geometrías que cambiaron solo se **detectan y se listan**, sin aplicarse.

> [!WARNING]
> **Actualizar geometrías** reemplaza la geometría por la del polígono del catastro. Si corrigió geometrías a mano en el destino, esas correcciones **se pierden**. Haga primero **Analizar sin cargar**, revise la lista de geometrías que cambian y recién después cargue (o desactive la opción).

Esta etapa **no corrige solapes** entre localidades: eso se resuelve en el frontend.

## Revisar y cargar

El paso **Revisar** resume las tablas y las opciones. **Analizar sin cargar** clasifica las localidades y revierte todo. **Cargar localidades** escribe en los destinos y pide escribir de nuevo la contraseña y el nombre de cada tabla destino.

Después del paso **Revisar** vienen **Ejecución** (el progreso) e **Informe**.

## Cómo leer el informe

Arriba aparecen cuatro totales: **Filas leídas**, **Candidatas**, **Omitidas** y **Geometrías que cambian**. Un banner indica si fue un análisis ("Análisis: las tablas de localidades no fueron modificadas.") o una carga real ("Carga confirmada: las tablas de localidades fueron modificadas.").

**Omitidas** muestra por qué no se cargaron algunas filas de origen:

| Motivo | Qué significa |
|---|---|
| Sin geometría | La localidad de origen no tiene geometría utilizable. |
| Provincia no encontrada | El nombre de la provincia del padrón no existe en la tabla de provincias. |
| Provincia ambigua | El nombre de la provincia coincide con más de una fila de la tabla de provincias. |
| Código nulo | La localidad de origen no tiene código. |
| Clave duplicada | Una misma provincia y nombre aparecen con códigos o geometrías distintos: ninguna de esas filas se carga. |

Por cada tabla destino hay un bloque con estas filas: **Insertadas**, **Actualizadas**, **Geometrías que cambian**, **Sin cambios**, **Sin cambios dentro de tolerancia**, **Faltantes en origen**, **Ambiguas** y **Código distinto** (el código del destino difiere del de origen; solo se informa).

Debajo hay listas desplegables: **Localidades insertadas**, **Geometrías que cambian** (con la distancia en metros y la proporción de área), **Faltantes en origen**, **Ambiguas**, **Código distinto** y **Muestras de filas omitidas**. Las listas de insertadas y de geometrías que cambian muestran **hasta 500 filas**; si hay más, una advertencia lo avisa ("Se listan las primeras 500 ..."). Las demás son muestras de hasta 20.

Si algún padrón urbano no encuentra su localidad en el origen (mismo departamento y mismo nombre), el informe lista esos **padrones urbanos sin localidad en el origen**, con su departamento, localidad y número. Esos padrones no se cargan en ninguna localidad: revise si la localidad está cargada con otro departamento. La lista muestra **hasta 500 padrones**; si hay más, una advertencia lo avisa ("Se listan los primeros 500 ..."). Aparece el botón **Descargar inconsistencias** para exportarlos.

Para tener todos los cambios en una planilla, use **Descargar CSV**: vea [Descargar el informe](descargar-informe.md).
