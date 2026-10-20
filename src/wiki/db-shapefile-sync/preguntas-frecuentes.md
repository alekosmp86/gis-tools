---
title: "Preguntas frecuentes y problemas comunes"
order: 5
---

# Preguntas frecuentes y problemas comunes

## Conexión

### El botón "Continuar" está deshabilitado

Se habilita recién cuando el paso actual está completo: la conexión establecida con éxito (paso 1) o la capa cargada correctamente (paso 2). Revise el mensaje que aparece en pantalla. Si volvió a un paso anterior, puede ser necesario conectar de nuevo. Vea [Paso 1: conectar la base de datos](base-de-datos.md).

### ¿Se guarda mi contraseña?

No. Los perfiles guardan servidor, puerto, base, usuario, esquema y tabla, pero **nunca la contraseña**.

## Capa espacial

### Aparece "Formato no soportado"

La herramienta solo acepta un archivo **`.zip`** que contenga el shapefile (`.shp`, `.dbf`, `.shx`) o un archivo **GeoJSON**. Si subió los archivos sueltos o un formato distinto, comprima el shapefile en un `.zip` y cárguelo de nuevo. Vea [Paso 2: preparar y cargar la capa](archivo-shapefile.md).

### Las entidades aparecen en un lugar equivocado del mapa

Lo más común es que el `.zip` **no incluya el `.prj`**: sin él la herramienta no puede convertir las coordenadas proyectadas y las trata como grados. Agregue el `.prj` correspondiente a la capa y cárguela de nuevo. Si la capa es GeoJSON, las coordenadas deben estar en longitud y latitud (grados).

### Los acentos o la ñ se ven mal

El `.dbf` probablemente se guardó con una codificación distinta. Vuelva a exportar la capa desde su programa de origen (por ejemplo QGIS) eligiendo la codificación UTF-8. Si no puede regenerarla, deje activado *Tolerar caracteres corruptos* en el paso 4: repara las fallas de codificación conocidas al comparar.

### Falta una columna que sí existe en la base

El formato shapefile limita los nombres de columna a **10 caracteres**, de modo que un nombre largo puede figurar cortado (`departamento` como `departamen`). En el paso 3, elija a mano el atributo correspondiente a cada columna de la base.

### La vista previa no muestra todas las entidades

Es lo esperado en capas muy grandes: la vista previa se limita a 25.000 entidades para que la pantalla siga fluida, y lo avisa con un cartel. La comparación usa **todas** las entidades.

### No encuentro mi archivo en el Catálogo Cartográfico

La pestaña solo lista los archivos de las fuentes vigiladas, y en esta herramienta solo los de tipo **SHP, ZIP, GeoJSON y JSON**. Los archivos CSV figuran en el catálogo de la herramienta [DB vs. CSV](/wiki/db-csv-sync). Si la fuente publica la capa en otro formato, descárguela y cárguela desde su equipo con **Subir desde PC**.

## Comparación

### Hay muchas diferencias que no parecen reales

Revise que el **SUID** elegido identifique de verdad cada registro, que los atributos mapeados sean los correspondientes y que no haya diferencias de escritura o de codificación (opción *Tolerar caracteres corruptos*).

### Hay registros "Solo en base de datos" y no se eliminan

Es lo esperado: los parches solo **actualizan** e **insertan**. Los registros que existen únicamente en la base se informan, pero la herramienta no los elimina, y no tienen casilla de selección.

### Un registro no tiene casilla o está deshabilitada

Solo se pueden marcar los registros con *Diferencia de Atributos*, *Diferencia Geométrica* y *Solo en Archivo Shapefile*. Si la casilla está deshabilitada con el aviso *Sin clave primaria*, el registro es parte de un grupo con SUID repetido y no hay una clave primaria que permita actualizarlo con seguridad.

### Los botones de SQL están deshabilitados

No hay ningún registro marcado. Marque los registros que quiera corregir o use **Seleccionar todos (filtro actual)**.

### La ejecución es muy lenta en una tabla grande

En el paso 4 active *Habilitar búsqueda por PK* si la tabla tiene clave primaria: los `UPDATE` usan esa columna y evitan recorrer toda la tabla.

### Falla la inserción de registros nuevos

Si la tabla tiene columnas `NOT NULL` sin valor por defecto que no vienen en la capa, indique un valor en **Valores por Defecto para Inserciones (INSERT)** (paso 4). Si una restricción de unicidad rechaza una fila repetida, revise los SUID duplicados.

### Ejecuté un parche y hubo errores en algunos lotes

Las sentencias se confirman en lotes de 500 y un lote con error **no anula** los anteriores ni detiene los siguientes. Revise el resumen de la ejecución, corrija la causa y vuelva a comparar para obtener los parches que quedaron pendientes.

### ¿Puedo deshacer un parche?

No desde la herramienta. Antes de ejecutar, revise el script (**Copiar SQL** o **Descargar .sql**) y tenga una copia de seguridad.
