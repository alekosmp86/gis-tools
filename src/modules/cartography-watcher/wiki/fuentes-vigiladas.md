---
title: "Fuentes vigiladas"
order: 2
---

# Fuentes vigiladas

Una **fuente vigilada** es un conjunto de datos publicado en un portal (por ejemplo, *Ejes de vías de circulación*). Cada tarjeta del panel muestra el estado de una fuente.

> [!NOTE]
> Las fuentes se guardan en el servidor, no en su navegador. Por eso, todos los que usan la herramienta ven la misma lista.

## Agregar una fuente

1. En el panel, pegue en el campo **Vigilar fuente** una de estas dos cosas:
   - la dirección completa del conjunto en el portal, por ejemplo `https://catalogodatos.gub.uy/dataset/ide-ejes-vias-circulacion`;
   - solo el identificador del conjunto, por ejemplo `ide-ejes-vias-circulacion`. En ese caso se usa el portal `catalogodatos.gub.uy`.
2. Presione **Vigilar fuente**. Mientras se verifica aparece *"Verificando..."*. La herramienta consulta el portal antes de guardar.

Si la fuente no se puede agregar, aparece el motivo arriba del panel. Los más comunes:

| Mensaje | Qué hacer |
|---|---|
| *La URL o el identificador del conjunto de datos no puede estar vacío.* | Escriba la dirección o el identificador. |
| *La URL del catálogo no es válida.* | Revise que la dirección esté completa. |
| *No se pudo identificar el conjunto de datos en la URL... Debe incluir /dataset/<identificador>.* | Use la dirección de la página del conjunto, que contiene `/dataset/`. |
| *Ya existe una fuente vigilada para el conjunto...* | Ese conjunto ya está en la lista. No se duplica. |
| *No se pudo agregar la fuente.* | El portal no respondió o la consulta falló. Espere y reintente. |

## Qué muestra cada tarjeta

| Elemento | Significado |
|---|---|
| **Título** y **descripción** | Tomados del portal. |
| **Estado** (insignia) | Resume toda la fuente. Ver la tabla de estados. |
| **Recursos** | Cantidad de archivos que publica el conjunto, incluidos los que las herramientas de sincronización no pueden usar. |
| **Novedades** | Cuántos archivos están pendientes: nunca descargados o con una versión más nueva en el portal. Dice *Sin novedades* cuando no hay pendientes. |
| **Última consulta** | Cuándo se revisó la fuente por última vez. |
| **Ver en el portal** | Abre el conjunto en el portal, en otra pestaña. |

### Estados

| Estado | Significado |
|---|---|
| **Al día** | Todos los archivos del conjunto coinciden con el portal. No queda nada por descargar. |
| **Pendiente de descarga** | Hay al menos un archivo que todavía no se descargó, y ninguno descargado está desactualizado. |
| **Actualización disponible** | Hay al menos un archivo descargado que el portal reemplazó por una versión nueva. Tiene prioridad sobre *Pendiente de descarga*. |
| **Sin respuesta** | El portal no respondió. La tarjeta muestra el motivo en rojo. Las otras fuentes no se ven afectadas. |

> [!WARNING]
> En una fuente *Sin respuesta*, **Recursos** muestra 0 y **Novedades** dice *Sin novedades* porque no hubo consulta. Esas dos cifras no significan que el conjunto esté al día: confíe en el motivo que aparece en rojo y reintente con **Revisar ahora**.

> [!TIP]
> Si ve *Pendiente de descarga* aunque ya descargó algunos archivos, es porque faltan otros del mismo conjunto. Un archivo figura como pendiente cuando nunca se descargó o cuando el portal publicó una versión nueva (o cambió su tamaño).

## Revisar las novedades

El botón **Revisar ahora** vuelve a consultar todos los portales. Mientras lo hace, muestra *"Actualizando..."*. Use este botón cuando quiera saber si hay publicaciones nuevas en ese momento.

## Editar una fuente

Presione **Editar** en la tarjeta. Aparece el campo **URL o identificador del catálogo**, con la dirección actual. Después de presionar **Guardar**:

- La fuente conserva su lugar en el panel.
- El título y la descripción se actualizan desde el portal.
- Si el conjunto cambió de dirección en el portal, puede corregirla aquí.
- No se puede guardar una dirección que ya corresponde a otra fuente de la lista. Aparece un mensaje explicativo.
- Las fuentes que vienen con la herramienta se pueden editar, pero no quitar.

Si el identificador del conjunto cambia, los archivos ya descargados se trasladan a la carpeta del nuevo identificador. Si esa carpeta ya existe, no se toca nada.

## Dejar de vigilar una fuente

Presione **Dejar de vigilar**. La fuente sale de la lista. Los archivos que ya se descargaron quedan en la caché.

> [!WARNING]
> Las fuentes que vienen con la herramienta no tienen el botón **Dejar de vigilar**. Solo se pueden editar.

## Para ver también

- [Catálogo Cartográfico en las herramientas de sincronización](catalogo-cartografico.md)
- [Preguntas frecuentes y problemas comunes](preguntas-frecuentes.md)
