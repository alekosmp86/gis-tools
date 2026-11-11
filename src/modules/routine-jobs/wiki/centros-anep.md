---
title: "Carga de centros ANEP"
order: 6
---

# Carga de centros ANEP

Este trabajo reemplaza por completo la tabla final de **centros educativos de ANEP** (CEIP, CES, CETP y CFE) con los datos de una tabla de paso. Tiene su propia tarjeta en la lista de trabajos y su propio asistente.

## De dónde salen los datos

La capa es `INE_NO_SEGURO_CLON_NS:centros_anep_2` del WFS de IDEuy. No figura en las capacidades del servicio, así que GeoServer no la puede publicar en cascada: solo responde a un `GetFeature` directo. Los datos se cargan en dos etapas:

1. **Staging**: descargue la capa como shapefile comprimido y cárguela con **DB vs. Shapefile** en modo **Reemplazo completo** en `bdj_carto.ine_centros_anep`. No hace falta ninguna herramienta nueva.
2. **Final**: este trabajo copia la tabla de staging en `carto.ine_centros_anep`.

URL de descarga (responde un `.zip` de unos 280 KB, con 2.902 centros):

```
https://mapas.ide.uy/geoserver-vectorial/INE_NO_SEGURO_CLON_NS/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=INE_NO_SEGURO_CLON_NS:centros_anep_2&outputFormat=SHAPE-ZIP
```

El shapefile viene en SRID 32721 (WGS 84 / UTM zona 21S). Las dos tablas deben existir antes de correr el trabajo: el trabajo no las crea y, si faltan, lo informa.

## Los pasos del asistente

| Paso | Qué se hace |
|---|---|
| **Conexión** | Servidor, base, usuario y contraseña. Muestra la nota con el aviso de cargar antes el staging y la URL de descarga. |
| **Tablas** | La tabla de staging (por defecto `bdj_carto.ine_centros_anep`, solo se lee) y la tabla final (por defecto `carto.ine_centros_anep`, se escribe). Cada una debe tener las columnas `ruee`, `subsistema`, `nombre` y `geom`. |
| **Revisar** | Resumen, contraseña escrita de nuevo y la confirmación de que la tabla final se vacía y se vuelve a llenar. **Analizar** corre el análisis; **Cargar ahora** se habilita solo después de analizar los mismos datos, sin bloqueos. |
| **Resultado** | Progreso, informe y, en la carga real, el respaldo para revertir. |

## Qué copia el trabajo

La tabla final conserva todas las columnas de la de staging, con los mismos nombres y tipos. El trabajo copia las columnas que existen en las dos tablas, emparejadas por nombre, **salvo** las que la tabla final llena sola con un valor por defecto (la columna `id` serial o una identidad). La geometría se transforma con `ST_Transform` al SRID que declara la columna de geometría de la tabla final.

- Una columna de staging que **no existe** en la tabla final **bloquea** la carga, y el informe la nombra.
- Una columna de la tabla final que no existe en staging se informa como **información**; debe tener valor por defecto o admitir nulos.
- Una columna con el mismo nombre pero distinto tipo bloquea la carga.
- Staging y final deben ser tablas distintas.

## Analizar

El análisis corre en una transacción de solo lectura: **no se modificó ninguna tabla**. Informa:

- las filas de staging y las filas por `subsistema`;
- las filas con geometría nula o vacía, con `ruee` nulo, con `subsistema` nulo y las que tienen caracteres dañados (`U+FFFD`);
- los `ruee` que se repiten (grupos y filas, con la lista);
- las filas que hay ahora en la tabla final, las que habría después del reemplazo y la diferencia por `subsistema`.

**Bloquean** la carga: staging vacío, cualquier geometría nula o vacía, cualquier carácter dañado, una geometría sin SRID y los problemas de columnas de la sección anterior. **No bloquean**, solo se advierten: los `ruee` repetidos o nulos (la fuente los repite: 2.902 filas y 2.899 valores distintos) y el `subsistema` nulo.

Los privilegios de escritura que falten se muestran como información en el análisis y bloquean en la carga real. Hacen falta `SELECT` sobre staging y `SELECT`, `INSERT` y `DELETE` sobre la tabla final, más `USAGE` de la secuencia de su `id`.

## Cargar

La carga real es **destructiva**: vacía la tabla final y la vuelve a llenar. Se hace en **una sola transacción** que:

1. bloquea la tabla final;
2. revisa staging (si hay un bloqueo, no escribe nada);
3. escribe el **respaldo para revertir** antes de la primera escritura;
4. borra todas las filas con `DELETE` (nunca `TRUNCATE`, así se conservan los privilegios y las vistas que dependen de la tabla);
5. inserta las filas de staging y comprueba que **las filas insertadas sean igual a las de staging**; si no coinciden, revierte todo;
6. ejecuta `ANALYZE` sobre la tabla final y confirma.

Si falla el `COMMIT`, el informe dice que el resultado es desconocido: verifique la tabla final antes de reintentar.

### Respaldo para revertir

Antes de escribir se genera un archivo `.sql.gz` con las filas que tenía la tabla final. Se descarga solo y también con el botón **Descargar respaldo**. Para revertir, descomprímalo y ejecute el `.sql` completo contra la base: vacía la tabla final y vuelve a insertar sus filas anteriores. El servidor guarda una copia temporal durante 7 días; si el servidor se reinicia, el enlace deja de funcionar, así que descárguelo antes.

## Siguiente paso: publicar en GeoServer

GeoServer publica la tabla final y la dibuja con el estilo `puntos_iconos.sld`, que usa el atributo `subsistema` como filtro (CES y CFE llevan icono al acercarse; el resto, círculos).

1. En GeoServer, en **Estilos**, cree el estilo `puntos_iconos` subiendo `puntos_iconos.sld`. Suba en la misma carpeta de estilos las imágenes que usa: `ces.png`, `cfe.png` y `lazo.svg`.
2. En **Capas**, agregue una capa nueva desde el almacén de la base, elija `carto.ine_centros_anep` y publíquela. Declare el SRS 32721 y calcule los límites desde los datos.
3. En la pestaña **Publicación** de la capa, elija `puntos_iconos` como estilo por defecto.
4. Guarde y compruebe la capa con la vista previa.

La capa lee la tabla directamente: después de cada carga solo hay que **refrescar la capa en GeoServer si guarda caché**. No hace falta nada más.

Si algo falla, vea [Solución de problemas](solucion-de-problemas.md).
