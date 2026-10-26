---
title: "Cargar padrones"
order: 2
---

# Cargar padrones

Este trabajo carga el padrón a partir de las dos tablas catastrales de origen, la **rural** y la **urbana**, y escribe el resultado en una **tabla destino**. Se hace una vez por mes, cuando las tablas de origen se actualizan.

Antes de empezar, las tablas rural y urbana tienen que estar cargadas en la base con la herramienta de sincronización de shapefiles en modo de reemplazo.

## Qué hace la carga

- Lee todas las filas de la tabla rural y de la tabla urbana.
- Agrupa las filas: las rurales por departamento y padrón; las urbanas por departamento, localidad y padrón. Cada grupo genera **una sola fila** en la tabla destino.
- La geometría de cada grupo es la unión de las geometrías de sus filas, reproyectada al sistema de coordenadas de la tabla destino.
- Los atributos del grupo son los de su primera fila, ordenada por el identificador original (`gid`). El tipo queda como `RURAL` o `URBANO`, y la columna de archivo indica la tabla de origen.
- Todo se hace dentro de una sola transacción: si algo falla antes de confirmarse, la tabla destino queda como estaba.

## Los cinco pasos

El asistente tiene cinco pasos, que se ven en la barra superior: **Conexión**, **Tablas**, **Opciones**, **Revisar** y **Resultado**.

### 1. Conexión

Complete el servidor (host), el puerto, la base de datos, el usuario y la contraseña.

Un **perfil** guarda el servidor, el puerto, la base, el usuario, el esquema, las tres tablas y las opciones, para no volver a escribirlos cada mes. Para guardar un perfil escriba su nombre y pulse **Guardar perfil**. Para cargarlo, elíjalo en la lista **Perfil guardado**. **La contraseña nunca se guarda en el perfil**: hay que escribirla en cada carga. Los perfiles se guardan en el navegador de esta computadora. Si guarda un perfil con el mismo nombre que otro existente, el nuevo reemplaza (sobrescribe) al anterior. Para borrar un perfil, elíjalo en la lista **Perfil guardado** y pulse **Eliminar perfil**.

### 2. Tablas

Escriba el **esquema** donde están las tablas. Después elija las tres tablas:

- **Tabla rural**: la tabla de origen rural.
- **Tabla urbana**: la tabla de origen urbana.
- **Tabla destino**: la tabla donde se escribe el padrón. No puede ser ninguna de las dos de origen.

Al elegir cada tabla, el asistente comprueba sus columnas y muestra cada una como encontrada (con el nombre real que tiene la tabla) o como faltante o ambigua. Si alguna columna necesaria falta o es ambigua, la tabla no sirve para la carga y no se puede continuar.

### 3. Opciones

- **Reparar geometrías inválidas**: activada por defecto. Con la opción activada, cada geometría inválida se corrige antes de agrupar y las geometrías válidas no se tocan. Con la opción desactivada no se corrige nada antes de agrupar: un grupo de una sola fila conserva su geometría tal cual está, aunque sea inválida, y un grupo de varias filas se une con la corrección aplicada solo dentro de la unión.

- **Vaciar tabla destino**: elija cómo se vacía la tabla antes de cargar.
  - **DELETE** (predeterminado): borra las filas una por una dentro de la transacción. No necesita privilegios especiales más allá de poder borrar en la tabla.
  - **TRUNCATE**: vacía la tabla de una sola vez. Conviene cuando la tabla destino es grande y nadie más la usa durante la carga.

> [!WARNING]
> TRUNCATE requiere el **privilegio TRUNCATE** sobre la tabla destino. El asistente lo comprueba antes de empezar: si falta, muestra un error con el nombre de la tabla y no escribe nada. TRUNCATE también **bloquea la tabla** hasta que termina la carga, y se rechaza si otra tabla tiene una clave foránea hacia el destino. Si no está seguro, deje DELETE.

- **Reiniciar secuencias del destino**: activada por defecto. Reinicia las secuencias de las columnas de la tabla destino que no se cargan desde las fuentes (por ejemplo, un identificador numérico que se autoincrementa). Al terminar la carga, cada secuencia queda en el máximo valor de su columna más uno, para que las próximas altas no repitan números.

Con esta opción activada, el usuario necesita los privilegios **USAGE y UPDATE** sobre esas secuencias (UPDATE para reiniciarlas y USAGE para leer su último valor) y **SELECT** sobre la tabla destino, porque se lee el máximo de cada columna. Si falta alguno, la carga falla y las filas de la tabla destino se restauran, pero las secuencias pueden quedar reiniciadas por debajo del máximo de su columna: en ese caso hay que ajustarlas a mano antes de insertar filas nuevas. Si no tiene esos privilegios, desactive la opción.

Con la opción desactivada la carga no reinicia nada, pero al insertar, cada fila nueva toma su número de las secuencias de las columnas con valor por defecto (`nextval`). Por eso la carga sigue necesitando **USAGE** (o UPDATE) sobre esas secuencias.

### 4. Revisar

El paso **Revisar** muestra el resumen completo: el servidor, la base, el esquema, las tres tablas y las opciones elegidas. Antes de cargar, lea la advertencia que indica qué tabla se va a vaciar y con qué modo.

Hay dos botones:

- **Analizar sin cargar**: ejecuta la carga completa, cuenta las filas y después revierte todo. No necesita confirmación adicional. Vea la sección Preguntas frecuentes.
- **Cargar ahora**: escribe los datos en la tabla destino. Solo se habilita cuando se cumplen las dos confirmaciones:
  1. escribir de nuevo la **contraseña** de la base de datos;
  2. escribir de nuevo el **nombre de la tabla destino**, exactamente como aparece en el paso **Tablas**.

La confirmación escrita (la contraseña y el nombre de la tabla destino) se borra cuando cambia la conexión, el esquema o la tabla destino, y también después de cada carga. Hay que escribirla otra vez.

### 5. Resultado

Mientras la carga corre, este paso muestra el paso en curso, el avance (por ejemplo `3 / 9`) y el tiempo transcurrido. Cuando termina, muestra el **informe**. El botón **Nueva carga** reinicia el asistente para empezar otra vez desde el paso 1.

## Cómo leer el informe

El informe empieza con un **banner** que resume el resultado:

| Banner | Significado |
|---|---|
| Simulación: no se modificó la tabla destino. | Se hizo un análisis con **Analizar sin cargar**. |
| Carga terminada: la tabla destino se actualizó. | La carga se confirmó sin advertencias. |
| La carga terminó con advertencias. Revise el informe. | La carga se confirmó, pero hay advertencias que conviene leer. |
| Resultado incierto: verificar la tabla destino antes de volver a cargar. | No se pudo confirmar la carga. Vea la sección Preguntas frecuentes. |

Después hay tres tablas: **Rural**, **Urbano** y **Totales**. Cada una tiene estas filas:

| Fila | Qué significa |
|---|---|
| Filas leídas | Filas que tenía la tabla de origen. |
| Reparadas | Con **Reparar geometrías inválidas** activada: filas cuya geometría se corrigió. |
| Insertadas inválidas | Con la reparación desactivada: grupos de una fila que se insertaron con geometría inválida. |
| Reparadas en la unión | Con la reparación desactivada: grupos de varias filas con geometría inválida que se corrigieron dentro de la unión. |
| Sin geometría | Filas excluidas porque no tienen una geometría utilizable. |
| Claves vacías | Filas excluidas porque les falta el departamento, el padrón o, en urbano, la localidad. |
| Grupos | Filas que se insertan en la tabla destino: una por grupo. |
| Filas fusionadas | Filas que se unieron en un grupo: filas leídas, menos las claves vacías, menos las filas sin geometría, menos los grupos. |
| Conflictos de atributos | Grupos cuyas filas tienen valores distintos en algún atributo, por ejemplo dos nombres de departamento escritos de forma diferente. No bloquean la carga. |
| Insertadas | Filas escritas en la tabla destino. Debe coincidir con los grupos: si no coincide, la carga se revierte. |

La tabla **Totales** suma las filas leídas, los grupos, las filas fusionadas y las insertadas de ambos tipos.

El informe incluye también:

- **Conflictos de atributos**: hasta 20 ejemplos, con la clave del grupo, la columna y los valores que chocan.
- **Códigos de localidad ambiguos**: pares de departamento y código de localidad que aparecen con más de un nombre de localidad.
- **Tiempos por paso**: cuánto tardó cada paso, en segundos, y el total.
- **Estadísticas**: si la base pudo actualizar sus estadísticas después de la carga (**Estadísticas actualizadas**), no pudo (**No se pudieron actualizar las estadísticas**) o no se hizo (**No se actualizaron las estadísticas**). Si la base informó un motivo, aparece debajo.

## Advertencias

Las advertencias se listan debajo de las tablas. No detienen la carga. Los textos siguientes son ejemplos del sentido de cada advertencia, no el texto exacto que aparece en pantalla:

- **Filas con clave nula**: se excluyeron de la carga porque les falta el departamento, el padrón o la localidad.
- **Filas sin geometría utilizable**: se excluyeron de la carga.
- **Grupos con atributos en conflicto**: los datos de las filas de un mismo grupo no coinciden. Se carga la primera fila del grupo; revise los ejemplos del informe.
- **Geometrías inválidas insertadas sin reparar**: con la reparación desactivada, la tabla destino quedó con geometrías inválidas.
- **Grupos reparados dentro de la unión**: con la reparación desactivada, se corrigieron al unir.
- **Códigos de localidad ambiguos**: un mismo código de localidad corresponde a más de un nombre.
- **No se pudo confirmar el COMMIT**: la base no confirmó la carga. Vea la sección Preguntas frecuentes.

## Preguntas frecuentes

### ¿Analizar sin cargar modifica la tabla destino?

No. El análisis hace la carga completa dentro de una transacción, cuenta las filas y la revierte: la tabla destino queda igual, y el banner lo indica. Hay dos efectos que conviene conocer:

- Las secuencias no se reinician ni se reparan durante el análisis, pero los identificadores que consume el análisis no se devuelven. La siguiente carga real puede dejar huecos en los números de la tabla destino. Es inofensivo: los números siguen siendo únicos.
- No se actualizan las estadísticas de la base.

### ¿Qué significa "Resultado incierto"?

Significa que la base de datos no confirmó la transacción (el COMMIT falló o no llegó respuesta). La carga pudo aplicarse o no.

Antes de volver a cargar:

1. Cuente las filas de la tabla destino, separadas por tipo (`RURAL` y `URBANO`), y compárelas con los grupos del informe de la carga anterior o con los grupos esperados.
2. Si la tabla contiene la carga completa, no vuelva a cargar. Si quedó vacía o incompleta, puede volver a cargar.

Este banner aparece cuando el servidor informa que la confirmación final de la carga (COMMIT) falló.

Si la aplicación pierde contacto con el servidor mientras sigue un trabajo, la pantalla muestra **No se pudo confirmar el resultado de la carga.** junto con el identificador del trabajo. Eso ocurre tras alrededor de un minuto o más sin respuesta. El trabajo puede seguir corriendo en el servidor, así que espere a que termine.

En los dos casos, verifique la tabla destino antes de repetir la carga.

### ¿Qué privilegios necesita el usuario de la base?

- **Lectura** de la tabla rural y de la tabla urbana.
- **INSERT** sobre la tabla destino.
- **DELETE** sobre la tabla destino si elige el vaciado DELETE.
- **TRUNCATE** sobre la tabla destino si elige el vaciado TRUNCATE. Se comprueba antes de empezar.
- **SELECT** sobre la tabla destino, si está activada la opción **Reiniciar secuencias del destino** (se lee el máximo de cada columna).
- **USAGE** y **UPDATE** sobre las secuencias que no se cargan desde las fuentes, si está activada la opción **Reiniciar secuencias del destino**.
- **USAGE** (o UPDATE) sobre las secuencias de las columnas con valor por defecto (`nextval`), también con la opción desactivada: cada fila nueva toma su número.

El trabajo no crea tablas ni objetos nuevos.

### ¿Por qué me pide la contraseña y el nombre de la tabla destino otra vez?

Para confirmar que la carga es intencional. La contraseña no se guarda en los perfiles, y el nombre de la tabla destino debe coincidir exactamente con el que se eligió en el paso **Tablas**.

### ¿Puedo cambiar de página mientras la carga corre?

Sí. La carga sigue en el servidor, y el avance se conserva mientras se navega dentro de la aplicación.

Si **recarga la página**, el asistente vuelve al paso 1 y deja de mostrar el avance y el informe. La carga sigue su curso en el servidor: antes de volver a cargar, verifique la tabla destino como se indica en la pregunta sobre el resultado incierto.

### ¿Puedo empezar otra carga mientras una está en curso?

No sobre la misma tabla destino. El servidor responde que ya hay una carga en curso para esa tabla. Espere a que termine y luego pulse **Nueva carga**.
