---
title: "Preguntas frecuentes y problemas comunes"
order: 5
---

# Preguntas frecuentes y problemas comunes

## Conexión

### El botón "Continuar" está deshabilitado

Se habilita recién cuando la conexión del paso actual se estableció con éxito (mensaje verde *Conexión establecida con éxito*). Presione **Conectar y Obtener Columnas** y revise el mensaje que aparece. Si volvió a un paso anterior, puede ser necesario conectar de nuevo. Vea [Conectar las bases de datos](conexion.md).

### Aparece "Por favor ingrese el nombre de la base de datos, usuario y nombre de la tabla"

Faltan datos obligatorios en el formulario. Complete **Nombre de Base de Datos**, **Usuario** y **Nombre de la Tabla**.

### La conexión falla o no encuentra la tabla

Revise el servidor, el puerto y la contraseña. Verifique también el **esquema**: si la tabla no está en `public`, indique el esquema correcto. Confirme que su usuario tiene permiso para leer la tabla.

### ¿Se guarda mi contraseña?

No. Los perfiles guardan servidor, puerto, base, usuario, esquema y tabla, pero **nunca la contraseña**. Cada vez debe ingresarla.

### Tengo muchos perfiles y es difícil encontrar el que busco

Abra la lista **Perfiles guardados** y escriba en el buscador: filtra por nombre sin distinguir mayúsculas ni tildes.

## Modo Comparar

### Me aparecen diferencias en caracteres como Ñ o tildes

Puede tratarse de un problema de codificación al exportar. En el paso **Parámetros** deje activado *Tolerar caracteres corruptos*: reconoce las fallas de codificación conocidas sin ignorar diferencias reales.

### La comparación o la ejecución es muy lenta en una tabla grande

En el paso **Parámetros**, active *Habilitar búsqueda por PK* si la tabla tiene clave primaria: los `UPDATE` usan esa columna y evitan recorrer toda la tabla.

### Hay registros "Solo en DB Destino" y no se eliminan

Es lo esperado: los parches solo **actualizan** e **insertan**. Los registros que existen únicamente en el destino se informan, pero la herramienta no los elimina. Si necesita que el destino quede idéntico al origen, use el [Reemplazo completo](reemplazo-completo.md).

### Un `UPDATE` no se generó para un SUID repetido

Cuando un SUID aparece más de una vez, solo se actualiza una fila de ese grupo si una **clave primaria con valor** la identifica. Si no, se omite y se muestra una advertencia, para no modificar todas las filas del grupo por error.

### Ejecuté un parche y hubo errores en algunos lotes

Las sentencias se confirman en lotes de 500 y un lote con error **no anula** los anteriores ni detiene los siguientes. Revise el resumen de la ejecución, corrija la causa y, si hace falta, genere de nuevo la comparación para obtener los parches que quedaron pendientes.

### Los botones de SQL están deshabilitados

No hay ningún registro marcado en la tabla de discrepancias. Marque los registros que quiera corregir o use **Seleccionar todos (filtro actual)**.

### Un registro no tiene casilla o está deshabilitada

Solo se pueden marcar los registros con *Diferencia de Atributos*, *Diferencia Geométrica* y los que existen únicamente en el origen (se insertan). Los que existen solo en el destino no tienen casilla porque la herramienta no genera sentencias para ellos. Si la casilla está deshabilitada con el aviso *Sin clave primaria*, el registro es parte de un grupo con SUID repetido y no hay una clave primaria que permita actualizarlo con seguridad.

### ¿Puedo deshacer un parche?

No desde la herramienta. Antes de ejecutar, revise el script (**Copiar SQL** o **Descargar .sql**) y tenga una copia de seguridad.

## Modo Reemplazo completo

### El botón "Vaciar destino y recargar desde origen" no se habilita

Debe escribir **exactamente** el `esquema.tabla` que se muestra (distingue mayúsculas y minúsculas) y completar la **contraseña del destino**.

### No puedo continuar desde el mapeo de columnas

Hay columnas **NOT NULL (requerido)** sin mapear y sin valor por defecto. Mapéelas a una columna del origen o indique un valor en **Valores por Defecto para Inserciones (INSERT)**.

### El reemplazo falla en el primer lote

Si falla el primer lote **no se pierde nada**: el vaciado se revierte y la tabla destino queda como estaba. Causas comunes:

- Su usuario no tiene permiso de `TRUNCATE` o `INSERT` sobre la tabla destino.
- Otra tabla tiene una **clave foránea** hacia la tabla destino. El vaciado no usa `CASCADE`, así que PostgreSQL lo rechaza en lugar de vaciar otras tablas.
- Falló el reinicio de secuencias porque su usuario no es propietario: desmarque *Reiniciar secuencias del destino* y reintente.
- Algún valor no cabe en el tipo de la columna destino.

### El reemplazo falló después del primer lote

La tabla destino puede haber quedado **parcialmente cargada**. Vuelva a ejecutar el Reemplazo completo: vacía y recarga otra vez, y es seguro repetirlo.

### Cerré la pestaña mientras se ejecutaba

El proceso se interrumpe al terminar el lote en curso (ningún lote queda a medias) y la tabla destino puede quedar parcialmente cargada. Abra la herramienta y ejecute el reemplazo otra vez.

### "Registros insertados" es menor que "Registros en origen"

Se muestra como advertencia, no como éxito. Revise el detalle de errores del resumen, corrija la causa y repita el reemplazo.

### Los identificadores nuevos chocan con los existentes

Si otra tabla usa la misma secuencia que la tabla destino, reiniciarla pudo provocar choques de identificadores. En ese caso desmarque *Reiniciar secuencias del destino* en la próxima ejecución y ajuste la secuencia manualmente.
