---
title: "Preguntas frecuentes y problemas comunes"
order: 5
---

# Preguntas frecuentes y problemas comunes

## Conexión

### El botón "Continuar" está deshabilitado

Se habilita recién cuando el paso actual está completo: la conexión establecida con éxito (paso 1) o el archivo cargado correctamente (paso 2). Revise el mensaje que aparece en pantalla. Si volvió a un paso anterior, puede ser necesario conectar de nuevo. Vea [Paso 1: conectar la base de datos](base-de-datos.md).

### ¿Se guarda mi contraseña?

No. Los perfiles guardan servidor, puerto, base, usuario, esquema y tabla, pero **nunca la contraseña**.

## Archivo CSV

### Aparece "El archivo CSV está vacío"

El archivo no tiene contenido. Exporte el archivo de nuevo y cárguelo otra vez.

### Los acentos o la ñ se ven mal

El archivo probablemente no está en UTF-8. Guárdelo o expórtelo en UTF-8 y vuelva a cargarlo. Si ya no puede regenerarlo, deje activado *Tolerar caracteres corruptos* en el paso 4: repara las fallas de codificación conocidas al comparar.

### Las columnas aparecen todas juntas o mal separadas

El separador se detecta a partir de la primera fila. Verifique que el archivo use el mismo separador (coma, punto y coma o tabulador) en todas las filas y que los textos que contienen el separador estén entre comillas.

### El archivo tiene geometrías pero no aparece el mapa

La herramienta reconoce las geometrías solo si están en una columna con un nombre conocido (`geom`, `geometry`, `wkt`, `wkb_geometry`, `the_geom`, `geom_wkt`, `geom_wkb`) o en columnas de latitud y longitud. Renombre la columna del archivo y cárguelo otra vez. El detalle está en [Paso 2: preparar y cargar el archivo CSV](archivo-csv.md).

### Las geometrías aparecen en un lugar equivocado

Compruebe en la vista previa del paso 2 si las entidades caen donde corresponde. Si no es así, revise las coordenadas del archivo (longitud y latitud, en grados) y corríjalas antes de comparar.

## Comparación

### Hay muchas diferencias que no parecen reales

Revise que el **SUID** elegido identifique de verdad cada registro, que los atributos mapeados sean los correspondientes y que no haya diferencias de escritura como `N/A` frente a vacío (opción *Tratar 'N/A', 'S/N' y vacío como equivalentes en el SUID*).

### Hay registros "Solo en base de datos" y no se eliminan

Es lo esperado: los parches solo **actualizan** e **insertan**. Los registros que existen únicamente en la base se informan, pero la herramienta no los elimina.

### La ejecución es muy lenta en una tabla grande

En el paso 4 active *Habilitar búsqueda por PK* si la tabla tiene clave primaria: los `UPDATE` usan esa columna y evitan recorrer toda la tabla.

### Un `UPDATE` no se generó para un SUID repetido

Cuando un SUID aparece más de una vez, solo se actualiza una fila de ese grupo si una **clave primaria con valor** la identifica. Si no, se omite y se muestra una advertencia, para no modificar todas las filas del grupo por error.

### Falla la inserción de registros nuevos

Si la tabla tiene columnas `NOT NULL` sin valor por defecto que no vienen en el archivo, indique un valor en **Valores por Defecto para Inserciones (INSERT)** (paso 4). Si una restricción de unicidad rechaza una fila repetida, revise los SUID duplicados.

### Ejecuté un parche y hubo errores en algunos lotes

Las sentencias se confirman en lotes de 500 y un lote con error **no anula** los anteriores ni detiene los siguientes. Revise el resumen de la ejecución, corrija la causa y vuelva a comparar para obtener los parches que quedaron pendientes.

### Los botones de SQL están deshabilitados

No hay ningún registro marcado en la tabla de discrepancias. Marque los registros que quiera corregir o use **Seleccionar todos (filtro actual)**.

### Un registro no tiene casilla o está deshabilitada

Solo se pueden marcar los registros con *Diferencia de Atributos*, *Diferencia Geométrica* y los que existen únicamente en el origen (se insertan). Los que existen solo en el destino no tienen casilla porque la herramienta no genera sentencias para ellos. Si la casilla está deshabilitada con el aviso *Sin clave primaria*, el registro es parte de un grupo con SUID repetido y no hay una clave primaria que permita actualizarlo con seguridad.

### ¿Puedo deshacer un parche?

No desde la herramienta. Antes de ejecutar, revise el script (**Copiar SQL** o **Descargar .sql**) y tenga una copia de seguridad.
