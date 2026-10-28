---
title: "Etapa 4: Completar unidades territoriales"
order: 5
---

# Etapa 4: Completar unidades territoriales

Esta etapa crea el **registro de dirección maestra** de cada unidad territorial que todavía no lo tiene y lo **enlaza** con la unidad. Se usa después de la etapa 3, cuyas unidades nuevas nacen sin dirección maestra.

## Qué hace

- Toma **todas** las unidades territoriales cuyo `id_address_master` está vacío, de cualquier tipo.
- Para cada una arma su URN, que es siempre `cgeo:territorial_unit:id:` seguido del id de la unidad.
- Si la dirección maestra **no tiene** un registro con ese URN, lo **crea** (latitud 0 y longitud 0). Su id sale de la secuencia de la tabla.
- Si **ya tiene exactamente un** registro con ese URN, no crea otro: solo **enlaza** la unidad con ese registro.
- Si tiene **dos o más** registros con ese URN, la unidad es **ambigua**: no se crea ni se enlaza nada, solo se informa. Hay que resolverlo a mano.
- Después escribe el id del registro en la unidad, solo si el campo seguía vacío.

No toca el id, la geometría ni ningún otro dato de las unidades, nunca borra filas y nunca pisa un enlace que ya existe. Puede ejecutarse varias veces: una segunda ejecución no encuentra nada que completar, salvo las ambiguas.

## Pasos

La conexión ya se pidió al entrar al trabajo. Los pasos son **Tablas**, **Revisar**, **Ejecución** e **Informe**. Esta etapa no tiene paso de opciones.

### Tablas

- **Unidades territoriales**: esquema y tabla de las unidades. Se propone la tabla que eligió en la etapa 3; si no hubo una, `carto.territorial_unit`.
- **Direcciones maestras**: esquema y tabla de las direcciones maestras. Se propone `carto.addresses_master`.

Las dos tablas deben ser distintas.

### Revisar

**Analizar sin cargar** hace todo el trabajo y revierte: ninguna tabla cambia. **Completar unidades territoriales** escribe en las **dos** tablas y pide escribir de nuevo la contraseña y el nombre de cada una.

## Cómo leer el informe

| Fila | Qué significa |
|---|---|
| **Unidades sin dirección maestra** | Cuántas unidades tenían el campo vacío al empezar. |
| **Registros creados** | Registros nuevos en la tabla de direcciones maestras. |
| **Unidades enlazadas** | Unidades a las que se les escribió el id de su registro. |
| **Ya tenían registro** | Unidades que ya tenían un registro con su URN: solo se enlazaron. |
| **Ambiguas** | Unidades con más de un registro con su URN: no se tocaron. |

Un banner indica si fue un análisis ("Análisis: las tablas de unidades territoriales y de direcciones maestras no fueron modificadas.") o un proceso real. La lista **Unidades enlazadas** muestra hasta 500 filas, con el id, el nombre, la provincia y el id de la dirección maestra, y avisa si hay más. La lista de **Ambiguas** muestra una muestra de hasta 20.

## Siguiente paso sugerido: actualizar la vista materializada

Esta herramienta **nunca actualiza la vista materializada**, porque puede que usted no tenga permiso para hacerlo. Cuando el proceso cambió algo (o cuando el análisis indica que cambiaría algo), el informe muestra la sección **Siguiente paso sugerido** con la sentencia lista para copiar:

```sql
REFRESH MATERIALIZED VIEW "carto"."mv_territorial_unit_full";
```

El esquema es el que eligió para la tabla de unidades territoriales. Ejecútela usted, o pídale a quien tenga el permiso que la ejecute.

## Cosas a tener en cuenta

- **Los ids de las direcciones maestras pueden tener saltos.** El análisis (**Analizar sin cargar**) también consume números de la secuencia de la tabla de direcciones maestras, aunque después revierta. Es normal y no afecta a los datos.
- **No la ejecute a la vez que la etapa 3 ni que otra sesión que escriba en esas tablas.** Los bloqueos de la etapa 3 y de la etapa 4 son independientes; si coinciden sobre las mismas filas, la base da un error de serialización y el proceso se revierte sin dejar nada a medias. Se vuelve a intentar.
- La etapa supone que **nadie más inserta** en la tabla de direcciones maestras mientras corre. No bloquea la tabla porque el usuario de la aplicación puede no tener ese privilegio.

## Si algo falla

Antes de confirmar, la etapa compara lo que escribió con lo que esperaba. Si no coincide, **revierte todo**. Los mensajes están en [Solución de problemas](solucion-de-problemas.md).

El botón **Descargar CSV** se explica en [Descargar el informe](descargar-informe.md).
