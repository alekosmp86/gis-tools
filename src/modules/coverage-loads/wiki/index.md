---
title: "Cargas de Coberturas"
order: 1
---

# Cargas de Coberturas

Esta herramienta carga a PostgreSQL los datos de cobertura que se actualizan cada mes y genera los reportes que se derivan de ellos. Trabaja siempre contra una base de datos (por ejemplo la de desarrollo o la de producción) y **antes de escribir cualquier dato le muestra qué va a cambiar**.

Se abre desde el portal, en la tarjeta **Cargas de Coberturas**.

## Qué se puede hacer

La herramienta se organiza en **etapas independientes**. Cada una carga un tipo de dato distinto, y puede hacer una, las dos o ninguna:

| Etapa | Qué carga | Cómo actualiza |
|---|---|---|
| **Indicadores LTE** | Los archivos mensuales `IndicadoresLTE_aaaammdd.csv` con la cobertura LTE por localidad. | Reemplaza el **corte** (la fecha) que trae cada archivo en el histórico, sin duplicar filas. |
| **Cargas SHP** | Un archivo de geometrías (`.shp`) de cobertura 5G, 3G, NB-IoT o LTE. | Reemplaza **todo el contenido** de la tabla de destino, en una sola operación que se revierte si algo falla. |

Al final, el paso **Resultado** resume cómo terminó cada etapa y permite **descargar los tres reportes CSV** de cobertura LTE.

## Cómo funciona

![Tarjeta de conexión, primer paso de la herramienta](images/01-conexion.png)

1. **Conexión.** Se confirma una sola vez la conexión a la base de datos. Recién entonces se habilitan las etapas.
2. **Etapas.** Se trabaja en cualquier orden. Cada etapa tiene su propia revisión previa: se ve qué se va a reemplazar y recién después se confirma. Una etapa que no se necesita se puede **omitir**.
3. **Resultado.** Muestra el estado de cada etapa y los reportes.

> [!TIP]
> En ambas etapas la herramienta **revisa antes de escribir**. La etapa de geometrías además ofrece un modo **Prueba**, que procesa el archivo y lo compara con la tabla actual sin modificarla. Úselo la primera vez que cargue un archivo.

## Qué necesita antes de empezar

- Los datos de conexión de la base: servidor, puerto, base de datos, usuario y contraseña. La contraseña no se guarda.
- Los archivos con el **nombre correcto**: `IndicadoresLTE_aaaammdd.csv` para los indicadores, y `<Prefijo>_aaaammdd.shp` para las geometrías.
- Que su usuario tenga **permisos de escritura** sobre las tablas que va a cargar (el detalle está en [Preguntas frecuentes](preguntas-frecuentes.md), sección *Permisos*). Si falta alguno, la propia pantalla de revisión lo informa y no deja continuar.

## Siguientes páginas

1. [Conectar a la base de datos y estados de las etapas](conexion.md)
2. [Etapa Indicadores LTE](indicadores-lte.md)
3. [Etapa Cargas SHP (geometrías)](cargas-geometrias.md)
4. [Resultado y reportes](resultado-y-reportes.md)
5. [Preguntas frecuentes y problemas comunes](preguntas-frecuentes.md)
