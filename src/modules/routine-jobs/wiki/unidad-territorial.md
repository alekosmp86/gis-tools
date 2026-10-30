---
title: "Etapa 3: Unidades territoriales"
order: 4
---

# Etapa 3: Actualizar unidades territoriales

Esta etapa lleva las localidades catastrales de la etapa 2 a la tabla de **unidades territoriales**.

## Qué hace

- **Inserta** las unidades nuevas, una por cada localidad catastral que todavía no tiene unidad. Su id sale de la secuencia de la tabla.
- **Actualiza en el lugar** la geometría y la fuente de las unidades que ya existen, solo cuando cambiaron.
- No toca el id, el nombre, la provincia ni el tipo de las unidades existentes: otras tablas y las URN dependen de ellos.
- Las unidades del tipo que no tienen localidad de origen **solo se informan** (**Faltantes en origen**), nunca se borran.
- Las unidades nuevas quedan sin dirección maestra: la [etapa 4](completar-unidad-territorial.md) se la crea y las enlaza.

Cada localidad se busca en el destino por **provincia, nombre y tipo de unidad**. El tipo es necesario porque otros tipos de unidad comparten nombres.

## Pasos

La conexión ya se pidió al entrar al trabajo. Los pasos son **Tablas**, **Opciones**, **Revisar**, **Ejecución** e **Informe**.

### Tablas

Las tablas vienen preelegidas: la de localidades es la que eligió en la etapa 2 o, si no hubo, `carto.cadastral_locality`; la de tipos es `carto.territorial_unit_type` y la de unidades es `carto.territorial_unit`. Puede cambiarlas.

- **Localidades de origen**: la tabla de localidades catastrales.
- **Tipos de unidad**: la tabla que asigna el tipo de cada unidad.
- **Unidades territoriales (destino)**: donde se escriben las unidades.

### Opciones

- **Nombre del tipo de localidad**: nombre exacto del tipo de unidad que representa a las localidades (en el uso mensual, `LOCALIDAD CATASTRAL`). Debe existir una sola vez en la tabla de tipos.
- **Tolerancia (m)**: distancia en metros por debajo de la cual una geometría se considera sin cambios. Predeterminado: 1,0 m.
- **Actualizar geometrías**: si se desactiva, las geometrías que cambiaron solo se detectan y se listan. Las inserciones y el cambio de fuente se aplican igual.

### Revisar

**Analizar sin cargar** clasifica las unidades y revierte todo. **Actualizar unidades territoriales** escribe en la tabla destino y pide escribir de nuevo la contraseña y el nombre de la tabla de unidades territoriales.

## Cómo leer el informe

Los totales son **Filas leídas**, **Candidatas**, **Omitidas**, **Insertadas**, **Actualizadas** y **Geometrías que cambian**. Un banner indica si fue un análisis ("Análisis: la tabla de unidades territoriales no fue modificada.") o una actualización real ("Actualización confirmada: la tabla de unidades territoriales fue modificada.").

Las filas del bloque de la tabla destino incluyen **Cambio de fuente**, **Sin cambios**, **Sin cambios dentro de tolerancia** y **Faltantes en origen**, además de las de insertadas y actualizadas.

Motivos de las filas **omitidas**:

| Motivo | Qué significa |
|---|---|
| Nombre nulo | La localidad de origen no tiene nombre. |
| Provincia nula | La localidad de origen no tiene provincia. |
| Fuente nula | La localidad de origen no tiene tipo de fuente, y la unidad necesita una fuente. |
| Sin geometría | La localidad de origen no tiene geometría utilizable. |
| Clave duplicada | Una misma provincia y nombre aparecen más de una vez en origen: ninguna de esas filas se aplica. |

En todos los casos se corrige en la tabla de origen y se vuelve a ejecutar la etapa. Las listas de insertadas y de geometrías que cambian muestran hasta 500 filas, con una advertencia si hay más.

El botón **Descargar CSV** se explica en [Descargar el informe](descargar-informe.md).
