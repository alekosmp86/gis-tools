---
title: "Etapa Avance FTTH"
order: 6
---

# Etapa Avance FTTH

Esta etapa reconstruye la tabla de **Avance FTTH** a partir de dos planillas CSV: una del **Interior** y otra de **Montevideo (UDPEM)**. Las planillas se cruzan con las zonas de SIGRA cargadas en la etapa [Capas SIGRA](capas-sigra.md).

Antes de escribir nada, la herramienta **revisa el plan de carga** y le muestra qué va a cambiar. Además, puede **probar la carga sin guardar**.

> [!NOTE]
> Esta etapa solo se habilita cuando **Capas SIGRA** está completada. Si no, la pantalla muestra: *"Complete primero Capas SIGRA para habilitar este paso."*

## Antes de empezar

Necesita dos archivos con **nombres exactos**:

| Planilla | Nombre del archivo |
|---|---|
| **Interior** | `SituacionFTTH_INT_ddmmaaaa.csv` |
| **Montevideo (UDPEM)** | `SituacionFTTH_UDPEM_ddmmaaaa.csv` |

- La fecha `ddmmaaaa` tiene que ser una fecha real (por ejemplo `25102026`). Las dos planillas deben tener la **misma fecha**.
- Son archivos **CSV** de **ISO-8859-1** (latin1), con campos separados por **punto y coma** (`;`). La primera línea es el encabezado y se ignora.
- Cada fila tiene **10 columnas**: `central;cable;zona;empresa;plano_al_com;ejecutor;director_obra;etiqueta;conca;edificio`.
- Cada archivo puede pesar hasta **10 MB**.
- Su usuario necesita los permisos de la sección *Permisos* de [Preguntas frecuentes](preguntas-frecuentes.md).

> [!TIP]
> Si guardó el CSV en UTF-8, los acentos y la `ñ` se leerán mal. Guárdelo de nuevo como ISO-8859-1 antes de cargarlo.

## Pasos

1. **Planillas de avance.** Arrastre las dos planillas al recuadro, o haga clic para elegirlas. Cada archivo se reconoce por su nombre. Si falta uno, sobra uno o un nombre no corresponde, la pantalla lo indica debajo de la lista. Presione **Revisar plan de carga**. Esta revisión no escribe nada.

2. **Revisión del plan de carga.** Muestra, en este orden:
   - **Errores** (en rojo). Impiden cargar: un archivo sin filas válidas, una capa de zonas vacía o privilegios que faltan.
   - **Advertencias** (plegables). Incluyen los avisos de reemplazo y de bloqueo de la base, y los avisos del plan (por ejemplo, una planilla con menos filas que hoy).
   - **Una tarjeta por archivo** con estos datos: *Filas en el archivo*, *Filas válidas*, *Filas rechazadas*, *Basura CZONA (se elimina)*, *Edificio vacío o #N/A*, *Claves repetidas* y *Filas hoy en la planilla*.
   - **Estado actual de la base de datos**: *Filas del Avance*, *Fecha de carga del Avance*, *Filas del historial* y *Zonas en SIGRA*.
   - **Situación de las zonas**: por cada situación, cuántas zonas hay en SIGRA, cuántas filas tiene el Avance actual y si la carga nueva la **Incluye** o la **Excluye**.
   - **Filas rechazadas**, si las hay (ver más abajo).

   Los botones de esta pantalla son **Atrás**, **Probar sin guardar** y **Cargar y reemplazar**.

3. **Probar o cargar.**
   - **Probar sin guardar** ejecuta toda la carga y los cinco reportes, y deshace todo al final. No queda nada guardado.
   - **Cargar y reemplazar** ejecuta la carga de verdad y deja los cambios guardados al terminar con éxito.

   Mientras corre, la pantalla muestra *"Reemplazando el Avance..."* o *"Probando la carga completa sin guardar..."*. Ninguno de los dos modos muestra un cuadro de confirmación: revise el plan antes de presionar.

4. **Resultado.** Se muestra *"Resultado de la prueba"* o *"Resultado de la carga"*, con:
   - el resumen de filas del Avance anterior copiadas al historial (o por qué se omitió), y la duración;
   - una tabla por archivo: *Filas cargadas*, *Basura eliminada*, *Filas en el Avance* y *Claves sin zona*;
   - una tabla de filas insertadas por situación de la zona;
   - una tabla de reportes, con *Falló* en los que no se pudieron generar;
   - los **reportes para descargar** (ver la sección siguiente).

   Después de una prueba, **Volver a la revisión** vuelve al plan. **Nueva carga** reinicia la etapa.

> [!WARNING]
> **Cargar y reemplazar** reemplaza el Avance actual y las dos tablas de planillas. El Avance anterior se copia al historial (salvo que ya se haya copiado hoy). Aun así, la carga no se deshace desde la herramienta: haga primero una prueba.

## Qué hace la carga

En una sola transacción, la herramienta:

1. reemplaza las tablas de planillas Interior y Montevideo por los archivos subidos (sin las filas *CZONA*, que se eliminan);
2. cruza las planillas con las zonas de SIGRA y reconstruye la tabla de Avance;
3. copia el Avance anterior al historial;
4. verifica que las cantidades de filas coincidan;
5. confirma los cambios.

Si algún paso falla, **se deshacen todos los cambios** y las tablas quedan como estaban. Los reportes se generan después de confirmar. Si uno falla, aparece como *Falló* y los demás se generan igual.

> [!TIP]
> Si el Avance ya se cargó hoy, el historial **no** se vuelve a copiar, para no archivar dos veces la misma versión. El plan lo indica como advertencia.

## Filas rechazadas

Una fila con problemas no detiene la carga: las filas válidas se cargan y las rechazadas se listan con su archivo, línea y motivo. Por ejemplo, un campo con más caracteres de los permitidos o una línea con un número de columnas incorrecto.

Para corregirlas, presione **Descargar filas rechazadas (CSV)**, corrija el archivo de origen y vuelva a cargarlo. Se listan hasta 200 filas; el título indica cuántas hay en total.

## Reportes

Los reportes se descargan desde el paso **Resultado** de la etapa, en la sección **Reportes del Avance FTTH**. Leen el estado actual de la base, así que se pueden descargar en cualquier momento, no solo después de una carga.

| Botón | Qué contiene |
|---|---|
| **Todos los reportes (ZIP)** | Los cinco reportes juntos en un archivo `AvanceFTTH_Reportes` con la fecha del día. |
| **Duplicados en las planillas de obras** | Claves (edificio, cable, zona) que se repiten en las planillas. |
| **Estados modificados con error** | Filas cuyo estado y datos no coinciden con los del histórico. |
| **Zonas en la planilla y no en SIGRA** | Zonas que están en la planilla pero no en SIGRA. |
| **Zonas en SIGRA y no en la planilla** | Zonas que están en SIGRA pero no en la planilla. |
| **Zonas FTTH fuera de la central** | Zonas que quedan fuera del límite de su central. |

Cada reporte es un archivo de texto con campos separados por `;`, en ISO-8859-1.

> [!NOTE]
> El reporte de **Zonas FTTH fuera de la central** es el más lento. Durante una prueba, la pantalla lo menciona en el aviso de espera.

## Para ver también

- [Capas SIGRA](capas-sigra.md): la etapa que tiene que estar completada antes.
- [Preguntas frecuentes y problemas comunes](preguntas-frecuentes.md): permisos y errores habituales.
