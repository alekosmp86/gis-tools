---
title: "Solución de problemas"
order: 8
---

# Solución de problemas

Los textos de esta página son los mensajes que muestra la pantalla. En todos los casos, un error antes de la confirmación **revierte la carga**: las tablas quedan como estaban.

## La columna id no tiene secuencia

> La columna "id" de ... no tiene secuencia: el proceso no puede asignar ids.

La tabla destino no tiene una secuencia detrás de su columna `id`, y el trabajo nunca escribe ids a mano. No se escribió nada. Hay que corregir la tabla (pedirle al administrador de la base que le asigne la secuencia) antes de repetir.

## Falta un privilegio sobre una secuencia

> No tiene privilegio UPDATE sobre la secuencia ..., necesario para ajustar los ids de ...

El usuario de la base no puede ajustar la secuencia de la tabla destino. Pida el permiso al administrador. En la etapa 1 también puede desactivar **Reiniciar secuencias del destino** si no tiene esos privilegios.

## Ya hay una carga en curso

Cada etapa bloquea su tabla destino mientras corre (la etapa 4 bloquea sus dos tablas: unidades y direcciones maestras; la etapa 5 bloquea la tabla de destino y, si enlaza direcciones maestras, también la tabla de direcciones maestras). Si la pantalla dice:

- Ya hay una carga en curso para esta tabla. (etapa 1)
- Ya hay una carga de localidades en curso para esta tabla. (etapa 2)
- Ya hay una actualización de unidades territoriales en curso para esta tabla. (etapa 3)
- Ya hay un proceso de direcciones maestras de unidades territoriales en curso para estas tablas. (etapa 4)
- Ya hay una actualización en curso para esta tabla. (etapa 5)

hay otra ejecución sobre la misma tabla, tal vez de otra persona. Espere a que termine y vuelva a intentar. Si recargó la página, el avance deja de verse pero la carga sigue en el servidor.

## Las cuentas no coinciden y la carga se revierte

Antes de confirmar, cada etapa compara lo que escribió con lo que el análisis esperaba. Si no coincide, **revierte todo** y muestra un error como:

- Las filas insertadas no coinciden con los grupos: ... (etapa 1)
- Las localidades insertadas (...) no coinciden con las nuevas del análisis (...) (etapa 2)
- Las geometrías actualizadas (...) no coinciden con las esperadas (...) (etapa 2)
- Las unidades insertadas (...) no coinciden con las nuevas del análisis (...) (etapa 3)
- Las unidades actualizadas (...) no coinciden con las esperadas (...) (etapa 3)
- Los registros de dirección maestra creados (...) no coinciden con los esperados (...) (etapa 4)
- Las unidades enlazadas (...) no coinciden con las esperadas (...) (etapa 4)
- Las unidades sin dirección maestra después del enlace (...) no coinciden con las ambiguas (...) (etapa 4)
- Los padrones insertados (...) no coinciden con los nuevos del análisis (...) (etapa 5)
- Las geometrías actualizadas (...) no coinciden con las esperadas (...) (etapa 5)
- Los registros de dirección maestra creados para padrones (...) no coinciden con los esperados (...) (etapa 5, con la opción de direcciones maestras)
- Los padrones enlazados (...) no coinciden con los esperados (...) (etapa 5, con la opción de direcciones maestras)
- Los padrones sin dirección maestra después del enlace (...) no coinciden con los ambiguos (...) (etapa 5, con la opción de direcciones maestras)

No quedó nada a medias. Alguien puede haber modificado las tablas mientras corría la carga: espere unos minutos y repita **Analizar sin cargar** y la carga real. Si se repite, avise al responsable de la herramienta con el mensaje completo.

## Mensajes de la etapa 5 (Actualizar padrones)

- **Tolerancia**: "La tolerancia debe ser un número mayor o igual que 0." Corrija el valor en **Opciones**; Siguiente se bloquea hasta entonces.
- **Tipo de localidad**: "Indique el tipo de localidad o quite la tabla de tipos de unidad." Escriba el tipo o quite la tabla de tipos.
- **Tipo de localidad no único**: "El tipo de localidad "..." aparece N veces en ...: debe aparecer exactamente una vez." Revise la tabla de tipos de unidad: el nombre debe existir una sola vez, sin distinguir mayúsculas.
- **Geometría sin SRID**: "... no tiene SRID: no se puede determinar el SRID de destino." La columna geométrica de la tabla de destino necesita un SRID métrico. Pida al administrador que lo defina.
- **Geometrías con SRID 0 o desconocido**: "... tiene N geometrías con SRID 0 o desconocido ...". Corrija la tabla de origen.
- **Columnas de la tabla de destino**: si falta una columna, el mensaje la nombra. La tabla de destino debe tener `id`, `number`, `type_padron`, `id_cadastral_locality`, `id_province` y `geometry`.
- **Tabla sin secuencia**: la columna `id` de la tabla de destino debe tener una secuencia (un tipo serial o identity). Sin ella no se pueden asignar ids a los padrones nuevos.
- **Clave de padrón no válida en la tabla de destino**: "La tabla de destino ... tiene N filas con una clave que esta etapa no genera ...". Corrija esas filas (tipo `RURAL` o `URBANO`, sin localidad en rural, número 0 o entero sin ceros a la izquierda) antes de cargar: así la etapa nunca inserta un padrón que ya está escrito de otra forma. Si la columna `number` no es de texto, el mensaje la nombra y hay que cambiarle el tipo.
- **Tabla de localidades equivocada**: "La tabla de localidades elegida (...) no contiene las localidades que usa la tabla de destino: N de M padrones apuntan a un id que no existe en ella." Los padrones guardan ids de `territorial_unit`: elija esa tabla. Si solo algunos padrones apuntan a un id inexistente, la carga continúa y el informe lo advierte.

Esta etapa no borra filas. Si una tabla de destino tiene disparadores o reglas, el análisis se rechaza y el mensaje los nombra: quítelos antes de cargar.

## Error de serialización (etapa 4)

> could not serialize access due to concurrent update

Otra sesión (por ejemplo la etapa 3) modificó las mismas filas mientras corría la etapa 4. La transacción se revirtió y no quedó nada a medias. Espere a que la otra ejecución termine y repita. Cada intento, incluso el análisis, puede dejar saltos en los ids de la secuencia de direcciones maestras.

## No se pudo confirmar el COMMIT

> No se pudo confirmar el COMMIT: verifique ... antes de reintentar.

Junto con el banner de resultado incierto ("Resultado incierto: ..."), significa que la base no confirmó la transacción: la carga pudo aplicarse o no. **No vuelva a cargar todavía.**

1. Mire la tabla destino de la etapa (en la etapa 2, las dos tablas de localidades; en la etapa 4, la de unidades territoriales y la de direcciones maestras).
2. Compare con el informe: ¿están las filas nuevas y las geometrías cambiadas?
3. Si la carga está completa, no repita. Si la tabla quedó sin cambios, puede volver a cargar.

Lo mismo vale si la pantalla muestra "No se pudo confirmar el resultado de la carga." con un "Identificador del trabajo": la aplicación perdió contacto con el servidor, que puede seguir trabajando. Espere y verifique las tablas.

## Un error de conexión o de catálogo

Si aparece "No se pudo consultar la base. Revise la conexión.", compruebe servidor, puerto, base, usuario y contraseña con **Cambiar conexión**.
