---
title: "Etapa 4: Actualizar padrones"
order: 5
---

# Etapa 4: Actualizar padrones

Esta etapa toma cada padrón de la tabla de origen (la de la etapa 1), lo resuelve contra las provincias y localidades de carto y lo lleva a la **tabla de destino** que usted elige:

- los padrones nuevos se **insertan**, y reciben su id de la secuencia de la tabla;
- los padrones que ya existen y cuya geometría cambió se **actualizan**: solo cambia la geometría, y solo si la opción **Actualizar geometrías** está activada;
- **nada se borra ni se renumera**. Los padrones que están en la tabla de destino pero ya no aparecen en el origen se cuentan y se listan, nunca se tocan.

## Pasos

La conexión ya se pidió al entrar al trabajo. Los pasos son **Tablas**, **Opciones**, **Revisar** y **Resultado**.

### Tablas

Las tablas vienen preelegidas (`bdj_carto.paispadron` como origen y `carto.padron`, `carto.province`, `carto.territorial_unit` y `carto.territorial_unit_type` en carto); puede cambiarlas.

Se eligen dos esquemas y estas tablas. El **Esquema de origen** contiene la tabla de origen. El **Esquema de carto** contiene la tabla de destino, las provincias, las localidades y, si se elige, los tipos de unidad.

| Campo | Qué es |
|---|---|
| **Tabla de origen** | La tabla de staging de la etapa 1 (no la original `catastro_paispadron`). |
| **Tabla de destino** | La tabla que recibe los datos: inserta los padrones nuevos y actualiza las geometrías cambiadas. Nunca borra filas ni cambia ids. |
| **Tabla de provincias** | Para resolver la provincia. |
| **Tabla de localidades** | Para resolver la localidad. Debe ser `territorial_unit`: los padrones guardan ids de unidades territoriales, no de localidades catastrales. |
| **Tabla de tipos de unidad (opcional)** | Si se indica, se usa para distinguir el tipo de localidad. |
| **Tabla de direcciones maestras** | Solo aparece con la opción de abajo activada. Debe ser distinta de la tabla de destino. |

**Cómo probar sin tocar carto.padron**: elija como **Tabla de destino** una tabla de prueba, por ejemplo `padron_tmp_actualizacion`. Como esta etapa nunca borra filas ni cambia ids, la misma tabla puede usarse después como `carto.padron` cuando usted lo decida, con el análisis ya revisado.

### Opciones

- **Tipo de localidad**: valor de la columna de tipo de unidad que marca las localidades, escrito tal cual aparece en la tabla de tipos. Solo aparece si eligió una tabla de tipos.
- **Tolerancia (m)**: distancia de Hausdorff en metros por debajo de la cual una geometría se considera sin cambios. Predeterminado: 1,0 m.
- **Actualizar geometrías**: si está activada, la geometría de los padrones existentes se reemplaza por la del catastro cuando cambió más allá de la tolerancia y su área cambió menos que el umbral de abajo. Predeterminado: activada. Con la opción desactivada, el análisis lista esos cambios como "detectados" pero no los aplica.
- **Umbral de cambio de área para aplicar (%)**: proporción del área que puede cambiar una geometría para que se aplique el reemplazo. La proporción es la parte del área que no coincide entre la geometría antigua y la nueva, respecto de su unión (0 % significa igual; 100 % significa que no se tocan). Predeterminado: 5 %. Un cambio con una proporción igual o mayor queda **pendiente**: no se escribe y se informa.

### Enlazar direcciones maestras de los padrones (opcional)

Es una casilla del paso **Tablas**, desactivada por defecto. Con ella activada, después de insertar y actualizar, la etapa crea la dirección maestra de cada padrón de la tabla de destino que todavía no la tiene y escribe su id en el padrón. El URN de cada registro es `cgeo:padron:id:` seguido del id del padrón, y el registro se crea con latitud 0 y longitud 0.

- Si ya hay exactamente un registro con ese URN, el padrón solo se enlaza con él.
- Si hay dos o más, el padrón es **ambiguo**: no se crea ni se enlaza nada, y el informe lo lista.
- El id del padrón y su geometría nunca cambian. Todo ocurre en la misma transacción que la carga: si algo no coincide, se revierte todo.

**Por qué viene desactivada**: crear direcciones maestras es una escritura en otra tabla, y no todas las cargas la necesitan. Actívela cuando los padrones de esta carga deben tener su dirección maestra.

**Advertencia**: con esta opción se crean direcciones maestras reales para los ids de la tabla de destino. Si la tabla de destino no se llama `padron`, **Revisar** muestra una advertencia destacada: antes de cargar, confirme que esa es la tabla que quiere enlazar.

### Revisar

Hay un solo botón, **Analizar**, y hace falta la contraseña para conectarse. El análisis solo lee: no modifica la base de datos, no escribe en la tabla de destino ni avanza su secuencia de ids, y guarda un plan de la carga durante tres días.

Los cambios se guardan después, desde el resultado del análisis. Ahí aparece el panel **Persistir cambios revisados**, con un resumen de lo que se aplicará (padrones nuevos, pares actualizados y geometrías actualizadas), la contraseña, que queda escrita desde el análisis, y el nombre de la tabla de destino, que debe escribir de nuevo. El botón queda bloqueado y muestra el motivo si falta el plan, si falta el nombre de la tabla o la contraseña, o si las elecciones de par cambiaron desde el análisis.

El servidor también rechaza el guardado si el plan caducó o cambió, o si las tablas u opciones no son las del análisis: el motivo aparece en pantalla y el botón **Volver a analizar** lleva a la revisión. Un plan se usa una sola vez.

## Cómo se clasifica cada padrón

Cada padrón del origen se busca en la tabla de destino por su clave: tipo de padrón, provincia, localidad (vacía en rural) y número.

| Clase | Qué significa | Qué hace la carga real |
|---|---|---|
| Insertada | No hay ningún padrón con esa clave en el destino. | Lo inserta, con un id nuevo de la secuencia. |
| Sin cambios | Existe una fila y su geometría es igual. | Nada. |
| Sin cambios dentro de tolerancia | Existe una fila y su geometría difiere, pero la distancia es menor o igual a la tolerancia. | Nada. |
| Geometría que cambia | Existe una fila y la distancia supera la tolerancia. | Reemplaza la geometría solo si **Actualizar geometrías** está activada y la proporción del área que cambió es menor que el umbral, o usted la aceptó (ver **Aceptar las geometrías pendientes**). Si no, queda **pendiente**: no se escribe y se informa. Una fila sin geometría en el destino se rellena con la del origen, sin umbral, si **Actualizar geometrías** está activada. |
| Ambigua | Hay más de una fila con esa clave en el destino. | Nada: no se adivina cuál es la correcta. Se informa. |
| Faltante en destino | Hay una fila en el destino cuya clave no tiene padrón utilizable en el origen. | Nada: se cuenta, se clasifica como reemplazada, subdividida, parcial o huérfana (ver **Padrones que ya no están en el catastro**) y se muestra. Nunca se borra. |

Un padrón del origen que se omitió (ver **Filas omitidas**) no tiene clase: no se inserta ni cambia nada.

## Padrones reclasificados o renumerados

Un padrón que cambió de tipo (rural o urbano), de localidad o de número, pero que sigue ocupando la misma forma en el mapa, no es un padrón nuevo. La carga lo empareja con la fila antigua y actualiza esa fila en su lugar: su id y su dirección maestra se conservan y nunca se renumera ninguna fila.

Un par se aplica cuando el padrón nuevo y la fila antigua están en la misma provincia, la forma nueva cubre a la antigua con la superposición mínima de uno de los dos niveles, las áreas están dentro de la banda de ese nivel y cada uno tiene una sola pareja:

- **Estricta**: la forma nueva cubre al menos el 98 % de la antigua y las áreas difieren como mucho en un 2 %.
- **Parcial**: la forma nueva cubre al menos el 85 % de la antigua y las áreas difieren como mucho en un 10 %. Un par parcial no se aplica solo: queda **pendiente** (**Pendiente: coincidencia parcial**) y no cambia nada hasta que usted lo elija en un grupo.

Un par estricto que comparte fila con otro candidato (ambiguo) no se aplica. La tolerancia no decide si un par se aplica: la distancia entre las formas ya no se muestra. Si el número cambia, solo cambia en un par aplicado.

Los pares que no se aplican no cambian nada: el padrón nuevo se inserta y la fila antigua se lista como faltante. Son **ambiguos** (una de las dos filas tiene más de una pareja) o **pendientes** (parciales que nadie eligió).

En la lista de pares pendientes, **Cambio de área (%)** es el cambio con signo: 0 significa la misma área, −2 significa un 2 % menos de área y 2 un 2 % más.

En el listado de geometrías que cambian, la columna se llama **Área no coincidente (%)**: es la parte del área combinada de la geometría anterior y la nueva que no se superpone. 0 significa que las dos formas son idénticas y 100 que no tienen nada en común.

Un grupo ambiguo solo se resuelve con una elección explícita. En el análisis, la sección **Grupos ambiguos** lista cada padrón nuevo con sus padrones antiguos candidatos: elija uno, o **No emparejar (insertar como nuevo)**. Sin elección no se empareja nada y el padrón nuevo se inserta. Un mismo padrón antiguo no se puede elegir para dos padrones nuevos: esas opciones quedan deshabilitadas. Con **Volver a analizar con la selección** el análisis se vuelve a calcular con las elecciones hechas.

Elegir un padrón antiguo también lo quita de los candidatos de los otros grupos: si eso deja a otro grupo con una sola pareja, esa pareja se aplica. El nuevo análisis lo muestra, así que una elección puede resolver grupos que no tocó.

Guardar exige que las elecciones (y las geometrías aceptadas) coincidan con las del último análisis completado. Si cambió la selección, el botón queda bloqueado con el aviso **Analice de nuevo con la selección de pares actual antes de persistir.** y hay que volver a analizar. En la revisión, **Elecciones de par incluidas** cuenta las elecciones que se enviarán.

El informe ya no lista las elecciones aparte: cada caso aparece en una sola lista. El grupo de una elección no aplicada se marca con **Elección no aplicada** solo si la elección que se envió en esa ejecución no se aplicó: una elección hecha después de la ejecución no se marca.

En el informe no hay una tabla de pares: los pares aplicados solo se cuentan (**Claves actualizadas**), los pendientes están en **Pares por coincidencia parcial pendientes** y los ambiguos en **Grupos ambiguos**. Una línea sobre las listas resume los aplicados sin revisión y lo que queda por revisar. Los pares aplicados aparecen en el CSV de cambios como **Clave actualizada** (los parciales elegidos, como **Clave actualizada (coincidencia parcial)**); los no aplicados y los pendientes, en el CSV de inconsistencias.

## Aceptar los pares pendientes

Un par de coincidencia parcial no se aplica solo: queda **Pendiente: coincidencia parcial**. En el análisis, la sección **Pares por coincidencia parcial pendientes** lista cada uno con sus claves anterior y nueva, su departamento, su localidad y su cambio de área.

- **Aceptar** elige el par. **Rechazar** quita esa elección.
- **Aceptar todos** elige todos los pares abiertos de la lista; **Rechazar todos** quita todas las elecciones de la lista.
- El contador **N aceptados de M pendientes** cuenta las elecciones. El estado de cada fila es **Aceptado** o **Pendiente**. Un par **Bloqueado** no se puede aceptar: otro padrón nuevo ya eligió el mismo padrón antiguo.
- Elegir no aplica el par todavía. Pulse **Volver a analizar con la selección**: el par queda **Aplicado** solo en ese nuevo análisis, y para guardar hay que volver a analizar.

Si el análisis tiene más pares pendientes que los que se listan, la sección lo indica: **Aceptar todos** actúa solo sobre los listados. **Aceptar todos** también se detiene al llegar a 5000 elecciones, el máximo de una solicitud, y lo indica con una nota.

## Ver padrones en el mapa

Cada fila de las tablas de geometrías que cambian, de pares, de pares pendientes y de padrones faltantes tiene el botón **Ver en mapa**, en su primera columna: esa columna queda fija a la izquierda, así que el botón se ve aunque la tabla se desplace hacia los lados. El botón abre una ventana sobre el informe con el padrón elegido, y solo ese:

- Cada contorno tiene una etiqueta fija con su tipo y número y cuál es: `RURAL 1345 · anterior` para el contorno anterior, `RURAL 8775 · nuevo` para el nuevo. Para un padrón faltante, cada padrón que lo reemplaza se etiqueta como `· parte`.
- El contorno anterior va en un color y el nuevo en otro. La leyenda indica cuál es cuál: **Padrón anterior** y **Padrón nuevo**.
- Antes de hacer clic en el mapa, el panel de detalle dice: *Haga clic en un padrón del mapa para ver todos sus datos.*
- Al hacer clic en un contorno, se resalta y el mapa se centra en él; su detalle completo aparece en el panel de detalle: tipo, departamento, localidad, número, id actual, áreas, diferencia de área (o área no coincidente) y coordenadas. Otro clic cambia la selección; un clic en una zona vacía del mapa la quita. Los clics no abren globos sobre el mapa.

La ventana se cierra con **Escape**, con la **X** o haciendo clic fuera de ella, y el foco vuelve al botón de la fila. En un ancho de teléfono ocupa toda la pantalla y el mapa queda arriba, con el detalle debajo.

El mapa necesita la contraseña de la conexión: si no la hay en el paso de conexión, la ventana se lo pide. Los contornos se piden al servidor cuando se abren y se guardan mientras la ventana esté abierta.

### Revisar dentro de la ventana del mapa

La ventana no solo muestra el padrón: también tiene la decisión de esa fila, así que se puede revisar una tabla entera sin cerrarla.

- **Anterior** y **Siguiente** recorren las filas de la tabla desde la que se abrió, en el orden de la tabla. El contador **N de M** indica en qué fila está.
- **Geometría que cambia**: muestra su estado (**Aceptada**, **Pendiente**, **Rechazada** o **Aplicada (bajo el umbral)**) y, si está pendiente, **Aceptar** y **Rechazar**. Ver **Aceptar las geometrías pendientes**.
- **Par por coincidencia parcial pendiente**: **Aceptar** y **Rechazar**, igual que en la tabla de pares pendientes.
- **Grupo ambiguo** (desde la tabla de pares o con **Ver en mapa** en la tarjeta del grupo): el mapa muestra el padrón nuevo y cada padrón antiguo candidato en un color distinto, con la etiqueta `· candidato 1`, `· candidato 2`, etc. Las opciones de la ventana usan el mismo número y color; elija una o **No emparejar (insertar como nuevo)**.
- **Padrón que ya no está en el catastro**: muestra destacados la clase, **Reemplazado por**, **Cubierto (%)** y **Referencias**, y su estado de eliminación (solo lectura, sin botones). Ver **Eliminación automática de padrones**.
- Un par ya aplicado solo se muestra: no tiene nada que decidir.

Las decisiones se guardan al instante en la selección del asistente y se ven también en la columna **Decisión** de cada tabla. Ninguna se aplica hasta pulsar **Volver a analizar con la selección** (disponible también en la ventana); al analizar de nuevo la ventana se cierra.

**Datos para buscar en Catastro** muestra, para el contorno seleccionado, el padrón nuevo (tipo, departamento, localidad catastral y número) con un botón para copiar cada dato. Para el contorno anterior, indica que no hay padrón nuevo que buscar. Para un padrón faltante, cada padrón que lo reemplaza tiene su propio bloque al seleccionarlo.

## Padrones que ya no están en el catastro

Un padrón de la tabla de destino que no tiene fila en el origen y que ningún par aplicado reclama ya no aparece en el catastro. El análisis busca su reemplazo entre los padrones nuevos que todavía no se emparejaron (los que se insertarían) de la misma provincia, y lo clasifica:

- **Subdividido**: dos o más padrones nuevos cubren juntos al menos el 90 % del área antigua. Cada parte cubre al menos el 5 % del área antigua; las partes más chicas no cuentan.
- **Reemplazado**: un solo padrón nuevo cubre al menos el 90 % del área antigua.
- **Cubierto en parte**: la unión de los padrones nuevos cubre entre el 50 % y el 90 % del área antigua.
- **Huérfano**: cubre menos del 50 % o no se superpone con ningún padrón nuevo.

**Cubierto (%)** es la parte del área antigua que cubren las partes que cuentan. **Reemplazado por** lista hasta 5 padrones nuevos, como «tipo número» con el porcentaje que cada uno cubre. **Referencias** cuenta las filas de las tablas de puntos de acceso y de direcciones del esquema de carto que apuntan al padrón antiguo; solo aparecen las tablas que existen y que puede leer.

La clasificación es informativa: el análisis no borra, no modifica ni inserta nada más que lo que ya muestra el informe. El informe lista hasta 500 filas, ordenadas por clase (subdivididos, reemplazados, cubiertos en parte y huérfanos) y luego por departamento, localidad y padrón; los contadores de cada clase son exactos. El CSV **Descargar padrones faltantes** exporta las filas de la lista. En una carga real no se muestra esta clasificación: el resultado solo indica que se muestra en el análisis previo.

## Eliminación automática de padrones

Al guardar, la carga real elimina los padrones que ya no están en el catastro, no tienen direcciones asociadas (ninguna tabla del esquema los referencia por `id_padron`) o las tenían y se reasignaron a sus partes (ver abajo), y no esperan una decisión de par. No hay nada que marcar. El análisis no borra nada: muestra la sección **Padrones que se eliminarán: N (sin direcciones asociadas o con direcciones reasignadas a sus partes)**, con la lista (hasta 500) y cuántos no se eliminan y por qué (**tiene direcciones asociadas**, **tiene un par sin resolver**). El resumen del botón de guardar incluye **N padrones eliminados**.

En la ventana del mapa y en la columna **Eliminación** de la tabla, cada padrón muestra **Se eliminará**, **No se elimina: tiene N direcciones asociadas** o **No se elimina: tiene un par sin resolver**.

Si el análisis no encuentra ninguna tabla que referencie padrones, o el usuario de la base no puede leer alguna, no se elimina ningún padrón y se muestra una advertencia con el motivo; el resto de la actualización sigue igual. Si una referencia aparece entre el análisis y el guardado, ese padrón no se elimina y se cuenta como no eliminado.

### Reasignación de direcciones de padrones subdivididos

Si un padrón faltante está subdividido (sus partes nuevas lo cubren) y todas las tablas que lo referencian tienen clave primaria de una sola columna, la carga real reasigna cada fila referenciante a la parte nueva más cercana a su punto (cero si lo contiene; el empate va a la parte de menor id) y luego elimina el padrón. El análisis muestra cuántas filas se reasignarán, por tabla. Los demás padrones con referencias siguen sin eliminarse.

El respaldo para revertir incluye los padrones eliminados (se vuelven a insertar) y las filas reasignadas. Al eliminar un padrón también se borra su dirección maestra, salvo que otra fila de destino la siga usando.

## Aceptar las geometrías pendientes

Una geometría que cambia con un cambio de área igual o superior al umbral queda **Pendiente**. Puede aceptarla para que se aplique de todos modos:

- En la ventana del mapa o en la fila de **Geometrías que cambian**, **Aceptar** la acepta y **Rechazar** quita la aceptación (sin aceptar, sigue pendiente).
- **Aceptar todos** acepta todas las pendientes de la lista; **Rechazar todos** quita todas las aceptaciones. El contador **N aceptadas de M pendientes (listadas)** cuenta las de la lista. Se aceptan como máximo 5000 geometrías por solicitud: al llegar al límite, una nota lo indica.
- La columna **Decisión** muestra **Aceptada**, **Pendiente**, **Rechazada** (aplicada en el análisis mostrado porque estaba aceptada, pero ya no lo está: el próximo análisis la deja pendiente) o **Aplicada (bajo el umbral)**.
- Aceptar no aplica nada todavía. Pulse **Volver a analizar con la selección**: en ese análisis la geometría aparece **Aplicada** y cuenta en **Actualizadas**. Para guardar hay que volver a analizar: si las aceptaciones cambiaron, el botón de guardar queda bloqueado con **Analice de nuevo con las geometrías aceptadas actuales antes de persistir.**
- **Aceptar todas (N)** acepta todas las pendientes del análisis, no solo las listadas; **Rechazar todas** lo quita. Ambos botones solo marcan la selección: no inician ningún análisis. Al pulsar guardar, el sistema vuelve a analizar con la selección y guarda. Si el último análisis se hizo con todas aceptadas, la lista queda vacía: tras **Rechazar todas** pulse **Volver a analizar con la selección** para recargarla.
- Solo se puede aceptar con **Actualizar geometrías** activada. Si una geometría aceptada ya no cambia en el nuevo análisis, las advertencias lo indican (**geometría aceptada no se aplicó**).

En la revisión, **Geometrías aceptadas** cuenta las que se enviarán.

## Geometrías pendientes del análisis

Las geometrías pendientes (las que superan el umbral de cambio de área y nadie aceptó) se cuentan con exactitud en **Geometrías pendientes**. El informe muestra hasta 500 de ellas. Cuando el análisis tiene pendientes, **Descargar geometrías pendientes (CSV)** baja todas, ordenadas por cambio de área de mayor a menor. El enlace vale mientras dure el plan del análisis (tres días). Una carga real consume el plan, así que el resultado de una carga real no ofrece ese CSV.

## Cómo leer el informe

Las tarjetas de arriba muestran **Filas leídas**, **Candidatas** (las que no se omitieron), **Omitidas**, **Insertadas**, **Actualizadas** y **Geometrías que cambian**. **Claves actualizadas** cuenta los padrones reclasificados o renumerados que se actualizan en su lugar.

Los banners posibles son "Análisis: la tabla de destino no fue modificada.", "Actualización confirmada: la tabla de destino fue modificada.", "La actualización terminó con advertencias. Revise el informe." y "Resultado incierto: hay que verificar la tabla de destino antes de volver a actualizar."

La sección de la tabla de destino trae los contadores de cada clase y listas desplegables:

- **Padrones insertados**, con su id nuevo;
- **Geometrías pendientes**: solo las pendientes (y las que usted aceptó o rechazó); las aplicadas bajo el umbral se cuentan en una línea y están en el CSV de cambios. Cada fila trae el id actual, el área anterior y la nueva en m², el cambio de área en % y la latitud y longitud del centroide. Van ordenadas por el cambio de área (de mayor a menor), y luego por departamento, localidad y padrón. El contador **Geometrías pendientes** indica el total exacto; para todas las pendientes, vea la sección **Geometrías pendientes del análisis**.
- **Padrones que ya no están en el catastro** (el contador **Faltantes en destino** indica el total), con el contador de cada clase y la lista de reemplazos. Los padrones antiguos de un par pendiente o ambiguo no se listan ahí: una línea indica cuántos esperan una decisión de par;
- **Ambiguas**, con muestras de clave.

Las listas muestran hasta 500 filas (las muestras, hasta 20). Cuando una lista se corta, su título dice "primeras N de M".

Si la opción de direcciones maestras está activada, aparece además una sección con la tabla de direcciones maestras: padrones sin dirección maestra, registros por crear y creados, padrones enlazados, los que ya tenían registro, los ambiguos y los que quedan sin dirección maestra después del enlace. Sus listas siguen las mismas reglas de corte.

## Respaldo para revertir

Una **actualización real** (no el análisis) genera un archivo que deshace exactamente lo que esa ejecución cambió en la tabla de destino. Su nombre es `padron-revert-<esquema>-<tabla>-AAAAMMDD-HHmmss.sql.gz`.

Al terminar la actualización, el navegador **descarga el archivo solo**: va a la carpeta de descargas o aparece el diálogo de guardar, según la configuración de su navegador. Si no se guardó, la sección **Respaldo para revertir** del informe tiene el botón **Descargar respaldo** para bajarlo de nuevo. La sección muestra el nombre del archivo, su tamaño y cuántos padrones y geometrías cambió la ejecución.

**Cómo revertir**: descomprima el archivo y ejecútelo completo contra la misma base, de una sola vez. Puede usar `psql` o pgAdmin / cualquier cliente SQL (el script es SQL puro, sin comandos de `psql`):

```
gunzip padron-revert-carto-padron-AAAAMMDD-HHmmss.sql.gz
psql -h <servidor> -U <usuario> -d <base> -v ON_ERROR_STOP=1 -f padron-revert-carto-padron-AAAAMMDD-HHmmss.sql
```

El script trae sus propios comentarios de cabecera con la fecha, la tabla y los conteos por tipo de cambio. Todo lo que hace va dentro de una transacción (`BEGIN` ... `COMMIT`): si un paso falla, ninguno de los cambios queda aplicado.

**Límites**:

- Revierte **solo los cambios de esta ejecución**. No vuelve la tabla a un estado anterior.
- Supone que nadie modificó esas filas después de la actualización. Si alguien cambió una de ellas, el script la sobrescribe igual.
- Los padrones nuevos se **borran por rangos de id**. Los ids de la secuencia no vuelven atrás, así que quedan huecos.
- Las direcciones maestras creadas por el enlace también se borran, solo si la opción de enlace estaba activada: únicamente las de los padrones que no tenían dirección maestra antes del enlace y cuyo id supera el máximo que tenía la tabla antes de la ejecución. Las demás no se tocan.
- El servidor guarda una copia temporal del archivo durante **7 días**. Las copias más viejas se eliminan al generar un respaldo nuevo.
- Los enlaces de descarga viven en la memoria del servidor: si el servidor se reinicia, dejan de funcionar aunque el archivo siga ahí. Descargue el respaldo antes de reiniciar.
- El análisis no genera respaldo: no escribe en la tabla de destino, así que no hay nada que revertir.

## Vistas materializadas

Esta etapa **no refresca las vistas materializadas** que leen el mapa y el WMS: `mv_padron` y `mv_padron_wms` (la del WMS sale de `mv_padron`). Después de una actualización real que cambió la tabla de destino, el informe muestra la sección **Siguiente paso sugerido** con las dos sentencias, en este orden:

```sql
REFRESH MATERIALIZED VIEW "carto"."mv_padron";
REFRESH MATERIALIZED VIEW "carto"."mv_padron_wms";
```

Refresque primero `mv_padron`, porque `mv_padron_wms` se construye sobre ella. El esquema es el de la tabla de destino. Ejecútelas usted, o pídale a quien tenga el permiso que lo haga. Hasta entonces, el mapa y el WMS siguen mostrando las geometrías anteriores. Un análisis o una actualización sin cambios no muestra la sugerencia.

## Filas omitidas

Una fila se omite, no se escribe, cuando no se puede resolver con seguridad. El informe cuenta cada motivo y muestra qué hacer:

| Motivo | Qué significa | Qué hacer |
|---|---|---|
| Clave nula | Falta el tipo de unidad (`unidadcat`), el departamento, la localidad (en urbano) o el número. | Corregir la tabla de origen. |
| Provincia no encontrada | El departamento del padrón no coincide con ningún nombre de la tabla de provincias. | Revisar el nombre o la tabla de provincias. |
| Provincia ambigua | El nombre coincide con más de una provincia. | Revisar la tabla de provincias. |
| Localidad no encontrada | La localidad no existe en su provincia. | Ver la lista de **Localidades no encontradas** y comprobar si esas localidades existen en la tabla de localidades (etapas 2 y 3). |
| Localidad ambigua | La localidad coincide con más de una en su provincia. | Revisar la tabla de localidades. |
| Sin geometría | La fila no tiene una geometría utilizable. | Corregir la geometría en la tabla de origen. |
| Clave duplicada | Varias filas comparten la misma clave y **todas se omiten**. | Revisar la tabla de origen. |

Se omiten todas las filas con clave duplicada porque quedarse con una sola sería arbitrario: no hay forma de saber cuál es la correcta. Por eso la etapa 1 unifica las claves duplicadas, y por eso esta etapa debe leer la tabla de staging.

El informe agrupa los omitidos por departamento y por localidad, y lista las **Localidades no encontradas** y **Localidades ambiguas** (hasta 20), además de ejemplos de filas omitidas y claves que chocan.

El botón **Descargar CSV** se explica en [Descargar el informe](descargar-informe.md).
