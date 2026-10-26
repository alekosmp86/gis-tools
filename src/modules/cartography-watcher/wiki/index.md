---
title: "Observador de Actualizaciones Cartográficas"
order: 1
---

# Observador de Actualizaciones Cartográficas

El observador vigila catálogos abiertos de datos espaciales, como el catálogo de datos del Uruguay, y avisa cuando se publica una versión nueva de un archivo que le interesa. También le permite **descargar esos archivos** y usarlos directamente en las herramientas de sincronización, sin tener que buscarlos a mano en el portal.

Se abre desde el portal, en la tarjeta **Observador de Actualizaciones Cartográficas**, o desde el menú como **Observador Cartográfico**.

## Para qué sirve

Comparar una tabla de la base con cartografía oficial implica revisar el portal a mano, notar que hay una publicación nueva, descargar el archivo (a veces de decenas de megabytes), encontrarlo y subirlo a la herramienta de sincronización. El observador hace ese recorrido por usted:

- Le indica qué archivos publicados **no tiene descargados** o **tienen una versión más nueva**.
- Guarda una copia de cada archivo descargado (la **caché**), para no volver a bajarlo cada vez.
- Muestra el catálogo dentro de las herramientas de sincronización, en la pestaña **Catálogo Cartográfico**.

## Qué se puede hacer

| Acción | Dónde | Qué pasa |
|---|---|---|
| Vigilar un conjunto de datos nuevo | Panel del observador, campo **Vigilar fuente** | Agrega el conjunto a la lista. |
| Revisar si hay novedades | Botón **Revisar ahora** | Consulta de nuevo todos los portales. |
| Corregir la dirección de una fuente | Botón **Editar** de la tarjeta | Cambia el conjunto o el portal de esa fuente. |
| Dejar de vigilar una fuente | Botón **Dejar de vigilar** | Quita la fuente de la lista. Las fuentes que vienen con la herramienta no se pueden quitar. |
| Descargar un archivo para sincronizar | Pestaña **Catálogo Cartográfico** de la herramienta de CSV o de Shapefile | Descarga el archivo y lo carga en la herramienta. |

## Siguientes páginas

1. [Fuentes vigiladas](fuentes-vigiladas.md): cómo agregar, revisar y editar las fuentes, y qué significan sus datos.
2. [Catálogo Cartográfico en las herramientas de sincronización](catalogo-cartografico.md): cómo elegir y descargar un archivo.
3. [Preguntas frecuentes y problemas comunes](preguntas-frecuentes.md)
