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

Cada etapa bloquea su tabla destino mientras corre (la etapa 4 bloquea sus dos tablas). Si la pantalla dice:

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
- Las filas insertadas (...) no coinciden con las filas aceptadas del informe (...) (etapa 5)

No quedó nada a medias. Alguien puede haber modificado las tablas mientras corría la carga: espere unos minutos y repita **Analizar sin cargar** y la carga real. Si se repite, avise al responsable de la herramienta con el mensaje completo.

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
