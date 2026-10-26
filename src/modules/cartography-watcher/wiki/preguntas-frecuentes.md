---
title: "Preguntas frecuentes y problemas comunes"
order: 4
---

# Preguntas frecuentes y problemas comunes

## ¿Por qué una fuente dice "Pendiente de descarga" si ya bajé un archivo?

Porque el conjunto tiene más archivos que todavía no se descargaron. El estado resume toda la fuente, no un solo archivo. Para ver cuáles faltan, abra el conjunto con **Ver en el portal** o despliegue la fuente en la pestaña **Catálogo Cartográfico**.

## Un archivo figura como pendiente, pero ya lo tengo

Un archivo figura como pendiente cuando nunca se descargó o cuando el portal publicó una versión nueva (o cambió su tamaño). Si lo descargó antes de esa publicación, aparecerá como pendiente hasta que lo vuelva a descargar desde el **Catálogo Cartográfico**. Al descargarlo, queda al día.

## La fuente dice "Sin respuesta"

El portal no respondió a tiempo, o devolvió un error. El motivo aparece en rojo debajo de la tarjeta. Espere un momento y presione **Revisar ahora**. Si sigue igual, pruebe **Ver en el portal** para comprobar si el sitio funciona.

Mientras la fuente está en esa situación, sus cifras de **Recursos** y **Novedades** no son confiables.

## ¿Puedo vigilar un conjunto de otro portal?

Sí. Pegue la dirección completa de la página del conjunto, la que contiene `/dataset/`. La herramienta toma el portal de esa dirección. Un identificador sin dirección se busca en `catalogodatos.gub.uy`.

## ¿Puedo quitar las fuentes que vienen con la herramienta?

No. Solo se pueden editar. Las fuentes agregadas por usted se pueden quitar con **Dejar de vigilar**.

## ¿Por qué no veo el archivo que busco en el Catálogo Cartográfico?

La pestaña muestra solo los formatos que la herramienta puede leer: `CSV` y `TXT` en la herramienta de CSV, y `SHP`, `ZIP`, `GeoJSON` y `JSON` en la de Shapefile. Un archivo en otro formato no aparece. Si la fuente no tiene ningún archivo compatible, lo indica el propio listado.

## ¿Se borran los archivos descargados si dejo de vigilar una fuente?

No. Quedan en la caché del servidor. La caché no se limpia sola ni desde la herramienta. Consulte con el administrador si necesita liberar espacio.

## ¿Qué pasa si el portal publica una versión nueva de un archivo que ya uso?

La próxima vez que elija ese archivo en el Catálogo Cartográfico, la herramienta comprueba el portal y descarga la versión nueva. La fuente pasa a **Actualización disponible** hasta que se descargue.

## ¿Las demás fuentes se ven afectadas si un portal no responde?

No. Cada fuente se consulta por separado. Una fuente sin respuesta no oculta las demás.

## ¿Puedo cancelar una descarga?

No hay botón para cancelar. Espere a que termine o falle. Mientras tanto, los demás archivos del catálogo quedan deshabilitados.

## ¿Quién ve mis fuentes?

Las fuentes se guardan en el servidor, así que las ve cualquiera que use la herramienta. Si agrega un conjunto, todos lo verán en el panel.

## Para ver también

- [Fuentes vigiladas](fuentes-vigiladas.md)
- [Catálogo Cartográfico en las herramientas de sincronización](catalogo-cartografico.md)
