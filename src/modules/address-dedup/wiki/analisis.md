---
title: "Análisis y exportación"
order: 2
---

# Análisis y exportación

Esta página explica cómo hacer el análisis, qué muestra cada pantalla y cómo exportar el resultado.

## Paso 1: completar la conexión

En el panel **Configuración** complete:

| Campo | Qué ingresar |
|---|---|
| **Servidor** | Dirección del servidor PostgreSQL. |
| **Puerto** | Puerto del servidor. |
| **Base de datos** | Base donde están las direcciones. |
| **Usuario** | Usuario de la base. |
| **Contraseña** | Contraseña del usuario. |

Para no volver a escribir los datos, presione **Guardar perfil**. El perfil guarda servidor, puerto, base y usuario, **nunca la contraseña**, y queda en el navegador de esta computadora. Para usarlo más tarde, elíjalo en el campo **Cargar perfil guardado**.

## Paso 2: elegir el departamento

1. Presione **Cargar departamentos**. Se necesita la contraseña, así que la lista no se carga sola.
2. Elija el departamento en la lista **Departamento** (*Seleccione un departamento*).

Para habilitar el botón hace falta haber escrito la base de datos, el usuario y la contraseña. Si cambia el servidor, la base, el usuario o la contraseña, la lista se vacía y hay que cargarla de nuevo.

## Paso 3: opciones (opcional)

| Opción | Efecto |
|---|---|
| **Eliminar ANTEL/TLK duplicado de una fuente protegida (IDE)** | Si un grupo tiene una fila de IDE y ninguna fila de ANTEL o TLK está vinculada a infraestructura, la fila de ANTEL o TLK de urn más bajo se marca para eliminar. Por defecto, se conserva. |
| **Incluir grupos sin eliminaciones (para revisión)** | Muestra también los grupos en los que todas las filas se conservan. Sirve para revisar sin buscar. |

La primera opción cambia la decisión de algunas filas, así que si la cambia, vuelva a analizar. La segunda solo cambia qué grupos se muestran.

## Paso 4: analizar

Presione **Analizar duplicados**. Mientras corre aparece el aviso: *"La consulta se ejecuta en PostgreSQL y puede tardar hasta 3 minutos. No cierre esta página."*

Al terminar, el panel **Configuración** se oculta y aparece una barra con el contexto del análisis: el departamento analizado, y los botones **Editar parámetros**, **Volver a ejecutar** y los de exportación. **Editar parámetros** vuelve a mostrar la configuración.

## Resumen

La pestaña **Resumen** tiene cinco indicadores:

| Indicador | Qué cuenta |
|---|---|
| **Grupos** | Cantidad de grupos de direcciones duplicadas. |
| **Filas** | Cantidad de filas que forman parte de esos grupos. |
| **A eliminar** | Filas con decisión *Eliminar*. |
| **A conservar** | Filas con decisión *Conservar*. |
| **Para revisar** | Filas que necesitan una mirada humana antes de decidir. Dice *Ninguna* si no hay. |

Cada indicador es un atajo: al presionarlo, la pestaña **Grupos** se filtra para mostrar lo que corresponde.

| Indicador | Filtro que aplica en Grupos |
|---|---|
| **Grupos** y **Filas** | Quita todos los filtros. |
| **A eliminar** | Decisión: *Eliminar*. |
| **A conservar** | Decisión: *Conservar*. |
| **Para revisar** | Activa *Solo para revisar*. |

Debajo de los indicadores aparecen dos tablas:

- **Decisión por fuente**: filas de cada decisión, separadas por ANTEL, TLK, IDE y *Otras / sin fuente*.
- **Motivos**: filas por motivo de decisión, con su proporción. Los motivos se explican en [Decisiones y motivos](decisiones.md).

## Grupos

La pestaña **Grupos** lista cada grupo de direcciones duplicadas. Cada grupo muestra, en su encabezado, cuántas filas tiene y cuántas se van a eliminar y conservar. Presione el encabezado para desplegar o plegar sus filas. Al pasar el puntero sobre el encabezado se ve la **clave de coincidencia**: los campos que hicieron que esas filas se consideraran la misma dirección.

### Filtros y orden

| Control | Opciones |
|---|---|
| **Buscar** | Texto libre: URN, padrón o calle. |
| **Decisión** | *Todas*, *Eliminar*, *Conservar*. |
| **Motivo** | *Todos* o un motivo concreto. |
| **Fuente** | *Todas* o una fuente. |
| **Orden** | *Grupo ascendente*, *Tamaño descendente*, *Eliminaciones descendente*. |
| **Solo para revisar** | Muestra solo los grupos con filas para revisar. |

Los botones **Expandir todo**, **Contraer todo** y **Limpiar filtros** actúan sobre todos los grupos a la vez. Los grupos se muestran de a 10, 25, 50 o 100 por página (por defecto, 25).

Si ningún grupo coincide con los filtros, aparece *"Ningún grupo coincide con los filtros aplicados."*

### Columnas de la tabla

| Columna | Qué muestra |
|---|---|
| **Fuente** | ANTEL, TLK o IDE. |
| **URN** | Identificador de la dirección. Con el botón **Copiar URN** se copia al portapapeles. |
| **Provincia**, **Cód. provincia**, **Cód. localidad**, **Localidad**, **Cód. postal**, **Localidad padrón / geo** | Ubicación de la dirección. |
| **Calle**, **Número**, **Letra**, **Manzana**, **Solar**, **Km** | Partes de la dirección. |
| **Padrón**, **Tipo de padrón**, **Ref. tramo** | Datos del padrón y de la referencia del tramo. |
| **Decisión** | *Conservar* o *Eliminar*. |
| **Motivo** | Por qué se decidió así. |

Las columnas entre *Provincia* y *Ref. tramo* son las que forman la clave de coincidencia. Un campo vacío aparece como un guion (*—*). La tabla tiene una barra de desplazamiento horizontal arriba y abajo para ver todas las columnas.

## Exportar

En la barra de contexto, junto a **Volver a ejecutar**, están los botones de exportación:

| Botón | Archivo | Contenido |
|---|---|---|
| **CSV** | Tabla | Todas las filas del análisis, una por fila, con las columnas *decision* y *decision_reason*. |
| **Puntos** | GeoJSON de puntos | Una entrada por dirección con coordenadas. Sirve para ver las decisiones en QGIS, con estilo por motivo. |
| **Enlaces** | GeoJSON de líneas | Una línea por grupo que une sus direcciones. |

> [!NOTE]
> Las exportaciones usan el **análisis completo** del último análisis, con sus opciones. No aplican los filtros que tenga puestos en la pantalla **Grupos**.

> [!NOTE]
> Las filas sin coordenadas no aparecen en los GeoJSON. La pantalla avisa cuántas se omitieron: *"N filas no tienen coordenadas y se omiten en los GeoJSON."*

## Preguntas frecuentes

**¿Puedo analizar otro departamento sin perder el análisis actual?**
Sí. Cambie el departamento en **Editar parámetros** y presione **Analizar duplicados**. El nuevo análisis reemplaza al anterior en pantalla.

**Cambié un filtro y los números del resumen no cambian.**
Es esperado: el resumen siempre muestra el análisis completo. Los filtros solo afectan a la pestaña **Grupos**.

**Los números no coinciden con los de una exportación.**
Revise que la exportación se haya hecho desde el mismo análisis y con las mismas opciones. Si cambió una opción, vuelva a analizar y exporte de nuevo.

**La consulta tarda mucho.**
Es normal: puede tardar hasta 3 minutos. Si la pantalla da error, reintente con **Volver a ejecutar**.

**Analizar, ¿modifica la base?**
No. El análisis solo lee datos.
