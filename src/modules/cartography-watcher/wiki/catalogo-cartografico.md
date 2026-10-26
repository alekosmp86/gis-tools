---
title: "Catálogo Cartográfico en las herramientas de sincronización"
order: 3
---

# Catálogo Cartográfico en las herramientas de sincronización

Las herramientas de sincronización **DB vs. CSV** y **DB vs. Shapefile** tienen, junto a la pestaña **Subir desde PC**, una pestaña **Catálogo Cartográfico**. Desde ahí se elige un archivo publicado en las fuentes vigiladas, sin salir de la herramienta.

## Qué archivos aparecen

Cada herramienta muestra solo los formatos que puede leer:

| Herramienta | Formatos que lista |
|---|---|
| **DB vs. CSV** | Archivos `CSV` y `TXT`. |
| **DB vs. Shapefile** | Archivos `SHP`, `ZIP`, `GeoJSON` y `JSON`. |

Si una fuente no publica ningún archivo de ese tipo, aparece en la lista con el mensaje *Sin archivos compatibles en este conjunto de datos.*

## Cómo elegir un archivo

1. Abra la pestaña **Catálogo Cartográfico** de la herramienta.
2. Lea el texto de la parte superior: *"Seleccione un archivo publicado en los catálogos vigilados. Se descarga una sola vez y queda en caché para las comparaciones siguientes."*
3. Presione el nombre de una fuente para desplegar sus archivos. A la derecha del nombre se ve cuántos archivos compatibles tiene. Presione de nuevo para plegarla.
4. Presione el archivo que quiere usar. Cada fila muestra:
   - el **nombre** del archivo;
   - el **formato**, el **tamaño** y la **fecha de publicación** del archivo en el portal;
   - una marca **En caché** si ya está descargado.
5. El archivo se descarga y se carga en la herramienta, como si lo hubiera subido desde su PC. A partir de ahí, siga con los pasos normales de la herramienta.

## Qué ve mientras se descarga

- En la fila del archivo aparece **Descargando...** y, cuando el tamaño es conocido, el porcentaje (por ejemplo `42%`).
- Mientras dura la descarga, los demás archivos quedan deshabilitados.
- **No hay botón para cancelar** una descarga en curso. Espere a que termine o falle.

> [!NOTE]
> La primera descarga de un archivo puede tardar, según su tamaño y la velocidad de la conexión al portal. Las siguientes son más rápidas, porque se usa la copia en caché.

## Caché

Cada archivo descargado queda guardado en el servidor. Cuando vuelve a elegir el mismo archivo:

- si el portal sigue con la misma versión, se usa la copia en caché (marca **En caché**);
- si el portal publicó una versión nueva, el archivo se descarga de nuevo antes de entregarlo.

La caché **no se borra sola**. Crece con cada archivo nuevo, y la herramienta no ofrece una forma de limpiarla. Consulte con el administrador si el espacio en disco se vuelve un problema.

## Mensajes de error

| Mensaje | Qué significa |
|---|---|
| *No se pudo consultar el catálogo.* | No se pudo leer la lista de fuentes. Reintente más tarde. |
| *No se pudo obtener el archivo del catálogo (HTTP <código>).* | El portal respondió con un error. Reintente; si se repite, abra la fuente con **Ver en el portal** desde el panel del observador. |
| *El recurso no publica una URL de descarga.* | El portal no ofrece el archivo para descargar. Verifíquelo en el portal. |
| *El recurso "..." ya no figura en el conjunto de datos "...".* | El archivo se retiró del portal. Revise la fuente en el panel del observador con **Revisar ahora**. |
| *No se pudo obtener el archivo seleccionado.* | Falló la descarga por una causa no identificada. Reintente. |

Los errores aparecen arriba de la lista de archivos. Un error de descarga no borra lo que ya estaba cargado en la herramienta.

> [!WARNING]
> Un archivo grande puede tardar varios minutos y ocupar espacio en el servidor. Si solo necesita revisar si hay una versión nueva, use las novedades de [Fuentes vigiladas](fuentes-vigiladas.md) en lugar de descargar.

## Para ver también

- [Fuentes vigiladas](fuentes-vigiladas.md)
- [Preguntas frecuentes y problemas comunes](preguntas-frecuentes.md)
- [Sincronización DB vs. CSV](/wiki/db-csv-sync)
- [Sincronización DB vs. Shapefile](/wiki/db-shapefile-sync)
