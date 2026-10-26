---
title: "Duplicados de Direcciones"
order: 1
---

# Duplicados de Direcciones

Esta herramienta busca direcciones que están cargadas más de una vez en la base de direcciones, con datos de **ANTEL**, **TLK** e **IDE**. Para cada fila propone si conviene **conservarla** o **eliminarla**, y permite exportar el resultado para revisarlo en QGIS.

Se abre desde el portal, en la tarjeta **Duplicados de Direcciones**.

> [!NOTE]
> **Analizar no modifica la base.** Solo la consulta y muestra el resultado. La base cambia únicamente si, en un paso aparte, usted confirma la eliminación (ver [Eliminación confirmada](eliminacion.md)).

## Cómo se trabaja

El recorrido tiene tres partes. Puede usar solo la primera si solo quiere revisar:

1. **Analizar.** Elija la base y el departamento, y presione **Analizar duplicados**. La consulta puede tardar hasta 3 minutos: no cierre la página. Ver [Análisis y exportación](analisis.md).
2. **Revisar.** Lea el resumen, recorra los grupos de direcciones duplicadas y entienda por qué cada fila se conserva o se elimina. Ver [Decisiones y motivos](decisiones.md).
3. **Eliminar (opcional).** Desde el resumen, puede confirmar la eliminación de las filas marcadas para eliminar. Primero se simula, y solo después de revisar el plan se ejecuta. Ver [Eliminación confirmada](eliminacion.md).

## Qué se puede hacer

| Acción | Para qué |
|---|---|
| Ver el resumen por decisión, fuente y motivo | Tener una idea del tamaño del problema antes de decidir nada. |
| Recorrer los grupos de duplicados | Revisar cada grupo y su decisión, fila por fila. |
| Filtrar y ordenar los grupos | Ver solo lo que necesita revisar: por decisión, motivo, fuente o texto. |
| Exportar en CSV o GeoJSON | Llevar el resultado a QGIS o a una planilla. |
| Guardar un perfil de conexión | No volver a escribir los datos de la base. La contraseña no se guarda. |
| Confirmar la eliminación de las filas marcadas para eliminar | Borrar esas filas de la base, con simulación y registro. |

## Siguientes páginas

1. [Análisis y exportación](analisis.md): cómo analizar, qué significan los indicadores y las columnas, y cómo exportar.
2. [Decisiones y motivos](decisiones.md): qué significa *Conservar* y *Eliminar*, y cada motivo.
3. [Eliminación confirmada](eliminacion.md): cómo se simula y se confirma la eliminación, y sus límites.
