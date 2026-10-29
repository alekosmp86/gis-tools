---
title: "Actualización mensual de carto"
order: 1
---

# Actualización mensual de carto

Esta herramienta reúne los trabajos de base de datos que se repiten cada mes. Hoy tiene un solo trabajo, **Actualización mensual de carto**, que lleva los datos del catastro a las tablas de carto en **etapas ordenadas**. Cada etapa tiene su propio asistente y su propio informe.

Se abre desde el portal, en la tarjeta **Trabajos de rutina**, o desde el menú. La página lista los trabajos; con **Abrir** se entra al trabajo y con **Volver a la lista** se regresa.

## El orden del mes

| Orden | Qué se hace | Dónde |
|---|---|---|
| Antes | Cargar los shapefiles `pais*` en la base | Herramienta de sincronización de shapefiles (**fuera** de este trabajo) |
| Etapa 1 | [Cargar padrones](cargar-padrones.md) | Este trabajo |
| Etapa 2 | [Cargar localidades](cargar-localidades.md) | Este trabajo |
| Etapa 3 | [Actualizar unidades territoriales](unidad-territorial.md) | Este trabajo |
| Etapa 4 | [Completar unidades territoriales](completar-unidad-territorial.md) | Este trabajo |
| Etapa 5 | [Actualizar padrones](actualizar-padron.md) | Este trabajo |
| Después | Correr la etapa 5 contra una tabla de prueba y, cuando el análisis esté conforme, contra `carto.padron`. Con la opción de direcciones maestras, la etapa 5 también enlaza los padrones nuevos | Este trabajo |

La etapa 5 puede correrse primero contra una tabla de prueba y después contra `carto.padron`, porque nunca borra filas ni cambia ids. Con la opción **Enlazar direcciones maestras de los padrones** activada, la etapa 5 crea y enlaza la dirección maestra de cada padrón que no la tiene, así que no hace falta volver a correr la etapa 4 después de la etapa 5. No hay una etapa aparte para aplicar los padrones.

Las etapas no se encadenan solas: usted abre cada una, revisa su informe y recién entonces pasa a la siguiente.

## Cómo se usa

1. Complete la **Conexión** (servidor, puerto, base, usuario y contraseña) y pulse **Continuar a las etapas**. Se pide **una sola vez** y se usa en todas las etapas. Para cambiarla, use **Cambiar conexión**.
2. En **Etapas** elija una con **Abrir**. Cada etapa pide sus propias tablas cuando se abre, no antes.
3. En cada etapa recorra los pasos, haga primero **Analizar sin cargar** y revise el informe.
4. Si el informe es el esperado, haga la carga real.
5. Con **Volver a las etapas** regresa a la lista.

Los perfiles guardan el servidor, el puerto, la base y el usuario; **la contraseña nunca se guarda** y hay que escribirla en cada carga real. Las tablas que elige en una etapa se proponen de nuevo en las siguientes, y puede cambiarlas.

## Analizar sin cargar y carga real

Todas las etapas tienen los mismos dos botones en el paso **Revisar**:

| Botón | Qué hace |
|---|---|
| **Analizar sin cargar** | Hace todo el trabajo, cuenta y clasifica, y después revierte. No cambia ninguna tabla. Pide la contraseña. |
| Botón de carga (**Cargar ahora**, **Cargar localidades**, **Actualizar unidades territoriales**, **Completar unidades territoriales** o **Actualizar padrones**, según la etapa) | Escribe los datos. Pide escribir de nuevo la contraseña y el nombre de la tabla destino. |

Conviene hacer siempre el análisis antes de la carga real: muestra qué se insertaría y qué cambiaría, sin tocar nada.

## Regla de oro: los ids no se tocan

Ninguna etapa reemplaza, borra ni renumera los ids de `carto.padron`, de las unidades territoriales ni de las localidades.

- Las filas nuevas toman su id de la secuencia de la tabla.
- Las actualizaciones nunca cambian el id.
- Las filas que existen en el destino pero no en el origen **solo se informan**: nunca se borran.
- La etapa 5 inserta padrones nuevos y actualiza solo la geometría de los existentes.

Esto importa porque otras tablas y las URN dependen de esos ids.

## Descargar el informe

Cada informe tiene un botón **Descargar CSV** con los cambios que se hicieron en la base. Sirve como historial mensual. Vea [Descargar el informe](descargar-informe.md).

Si algo falla, vea [Solución de problemas](solucion-de-problemas.md).
