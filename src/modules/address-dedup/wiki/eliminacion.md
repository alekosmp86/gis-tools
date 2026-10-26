---
title: "Eliminación confirmada"
order: 4
---

# Eliminación confirmada

La eliminación confirmada borra de la base las direcciones marcadas como **Eliminar** en el análisis. Es el único paso de la herramienta que modifica datos, y está protegido por varias confirmaciones.

> [!WARNING]
> La eliminación **borra filas de la base**. La herramienta no ofrece deshacerla. Haga siempre la simulación, revise el plan con su responsable y tenga una copia de seguridad si los datos son importantes.

## Qué se elimina

- Solo las filas con decisión **Eliminar**, según un análisis **recalculado en el momento** de la baja. No se usan los resultados que estaban en pantalla.
- Nunca se eliminan las filas **para revisar** ni las de **IDE** (ver [Decisiones y motivos](decisiones.md)).
- No se puede elegir un grupo ni una selección: la baja siempre alcanza el conjunto completo de filas a eliminar del departamento.

## Antes de empezar

- Haga el análisis del departamento y revise el resumen y los grupos.
- Tenga a mano el **responsable** que autoriza la baja y el **motivo** (por ejemplo, el número de ticket o el procedimiento).
- Confirme con un administrador de la base que la tabla de auditoría existe (ver *Requisitos de la base* más abajo).

## Paso a paso

1. **Iniciar.** En la pestaña **Resumen**, en el panel **Eliminación confirmada**, presione **Confirmar y eliminar**. Si el análisis no tiene filas a eliminar, el panel lo indica: *"El análisis no tiene filas a eliminar."*
2. **Completar el formulario.** En el cuadro **Confirmar y eliminar duplicados**:
   - **Responsable**: quién autoriza la baja (hasta 120 caracteres).
   - **Motivo**: por qué se eliminan (hasta 1000 caracteres).
   
   La nota dice: *"Primero se simula: nada se elimina hasta que revise el plan y confirme en un segundo paso."*
3. **Simular baja.** La herramienta calcula el plan sin tocar la base. Muestra:
   - **Direcciones a eliminar**: el total.
   - **Por fuente**: cuántas de cada fuente.
   - **Filas por tabla**: cuántas filas se borrarían en cada tabla, con nombres como *Direcciones*, *Puertas* o *Maestros de dirección*.
   - **Huella de la simulación**: un código que identifica exactamente ese plan.
   - **URN a eliminar**: la lista completa de URN. Se puede **Copiar URN** o **Descargar CSV** (columnas `urn,fuente`) para revisarla.
4. **Revisar el plan.** Si el plan tiene bloqueos, aparece el aviso *"La baja está detenida: estas direcciones no pueden eliminarse..."* y **Ejecutar eliminación** queda deshabilitado. Si no encontró direcciones, aparece *"La simulación no encontró direcciones a eliminar."*. Con **Volver a simular** se repite el cálculo.
5. **Ejecutar eliminación.** Solo disponible cuando el plan no tiene bloqueos. Muestra *"Eliminando..."* mientras corre.
6. **Resultado.** Se muestra **Baja ejecutada** con el identificador de la **Operación** y las **Filas eliminadas por tabla**.

> [!NOTE]
> Si la base cambió después de la simulación (por ejemplo, otra persona modificó esas direcciones), la baja se rechaza y no elimina nada. Vuelva a simular para ver el plan actualizado.

## Bloqueos

Un bloqueo significa que esa dirección **no puede eliminarse de forma segura**. Mientras haya un bloqueo, no se elimina ninguna fila. Las direcciones bloqueadas no se saltean: hay que resolverlas antes.

| Motivo que aparece | Qué significa |
|---|---|
| La URN está vacía | Falta el identificador de la dirección. |
| La URN no resuelve a una dirección y un maestro completos | La dirección está incompleta en la base. |
| La URN resuelve a más de un maestro o dirección | El identificador está repetido. |
| El maestro lo comparte otra dirección | Otra dirección usa el mismo maestro. |
| No es una puerta | La dirección no es una puerta. |
| También es una dirección interna | La dirección figura también como interna. |
| Tiene unidades internas asociadas | Eliminarla dejaría unidades sin dirección. |
| Figura como interna de otra puerta | Otra puerta la usa como interna. |
| Otra tabla referencia su maestro | Otra tabla de la base usa esa dirección. |

Los bloqueos se resuelven en la base, no en esta herramienta. Avise al administrador de direcciones.

## Requisitos de la base

Un administrador debe preparar la base antes de la primera baja. La herramienta no crea tablas ni cambia permisos. Si algo falta, la simulación o la ejecución se rechazan **sin escribir nada**, con uno de estos mensajes:

- *La tabla de auditoria carto.baja_direccion_operacion no existe en esta base. Debe crearla un administrador antes de ejecutar bajas.*
- *... existe con otra estructura; faltan columnas: ...*
- Un mensaje que indica los privilegios que faltan: `SELECT` e `INSERT` sobre la tabla de auditoría, o `DELETE` sobre las tablas de la baja.

Las tablas de la baja son: relaciones con internas, unidades territoriales, direcciones compactas, direcciones internas, puertas, direcciones y maestros de dirección.

## Registro de cada baja

Cada baja deja un registro en la tabla de auditoría con el responsable, el motivo, la fecha, el usuario de la base y el resultado (filas eliminadas por tabla). Si se repite una baja con el mismo identificador de operación, la herramienta no vuelve a borrar: muestra el resultado guardado con el aviso *"Esta operación ya se había ejecutado..."*.

## Lo que la herramienta no hace

- **No elimina en el índice Solr.** Es un paso manual.
- **No actualiza las vistas materializadas.** Es un paso manual.

La pantalla recuerda ambos pasos con el aviso *"Pasos manuales pendientes"*. Háganlos después de la baja.

## Preguntas frecuentes

**¿Puedo eliminar solo un grupo?**
No. La baja alcanza siempre todas las filas a eliminar del departamento, según la simulación.

**¿Qué pasa si cambio una opción después de simular?**
La simulación queda vieja. Vuelva a simular con las opciones que quiere aplicar.

**¿Por qué no aparece el botón Ejecutar eliminación?**
Porque el plan tiene bloqueos, o porque no hay filas a eliminar. Lea el mensaje que aparece en el plan.

**¿Qué hago si la baja falla a mitad de camino?**
La herramienta trabaja en una sola transacción: si algo no coincide, se deshace todo y no queda nada a medias. Revise el mensaje de error y vuelva a simular antes de reintentar.

**¿Puedo deshacer una baja?**
No desde la herramienta. Para recuperar filas hace falta una copia de seguridad.
