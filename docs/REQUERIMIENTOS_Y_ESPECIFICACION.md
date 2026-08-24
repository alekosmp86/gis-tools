# Especificación de Requerimientos y Fases de Desarrollo

Este documento especifica los requerimientos funcionales y el plan por fases para construir la herramienta de comparación de datos espaciales entre bases de datos PostgreSQL/PostGIS y archivos Shapefile.

---

## 1. Requerimientos Funcionales

### RF-1: Gestión de Conexión a Base de Datos
- **RF-1.1**: Formulario de configuración de conexión PostgreSQL (Host, Puerto, Nombre de Base de Datos, Usuario, Contraseña, Esquema).
- **RF-1.2**: Botón "Probar Conexión" que valide las credenciales e informe si la conexión es exitosa.
- **RF-1.3**: Selector de tablas disponibles dentro del esquema configurado.

### RF-2: Inspección e Interfaz de Selección de Columnas
- **RF-2.1**: Obtención automática del listado de columnas de la tabla seleccionada.
- **RF-2.2**: Selección interactiva de la columna **SUID** (Shared Unique Identifier).
- **RF-2.3**: Selección de atributos adicionales a comparar (excluyendo automáticamente la columna SUID y columnas geométricas como `geom`, `geometry`, `wkb_geometry`).
- **RF-2.4**: Opción para habilitar/deshabilitar la comparación de geometrías espaciales.

### RF-3: Carga de Capa Espacial (Shapefile / GeoJSON)
- **RF-3.1**: Carga drag-and-drop o explorador de archivos para paquetes `.zip` (que contengan `.shp`, `.dbf`, `.shx`, `.prj`) o archivos `.geojson`.
- **RF-3.2**: Lectura cliente/servidor e inspección de los campos almacenados en el archivo espacial.
- **RF-3.3**: Mapeo automático de nombres truncados a 10 caracteres (formato DBF) contra los nombres de columnas de la base de datos.

### RF-4: Motor de Comparación y Análisis
- **RF-4.1**: Ejecución del algoritmo de limpieza y normalización de SUID (`clean_suid_series`).
- **RF-4.2**: Identificación de registros faltantes en el Shapefile y faltantes en la base de datos.
- **RF-4.3**: Comparación insensible a mayúsculas/minúsculas y normalizada en espacios de los atributos seleccionados.
- **RF-4.4**: Comparación de geometría y verificación de concordancia espacial.

### RF-5: Interfaz de Resultados y Reportes
- **RF-5.1**: Resumen numérico (total de registros en DB, total en Shapefile, coincidencias, discrepancias de atributos, discrepancias geométricas).
- **RF-5.2**: Tabla interactiva de discrepancias con filtros por campo o tipo.
- **RF-5.3**: Visualización de capa geográfica interactiva (Leaflet) resaltando las geometrías con diferencias.
- **RF-5.4**: Exportación del informe detallado de diferencias en formato CSV.
- **RF-5.5**: Generador de scripts SQL de actualización PostGIS (`UPDATE` / `INSERT`).

---

## 2. Fases de Desarrollo Planificadas

| Fase | Descripción | Entregables |
|---|---|---|
| **Fase 1** | Limpieza de la UI y creación del workspace exclusivo para la herramienta SIG | Interfaz de herramienta única sin distracciones |
| **Fase 2** | API y formulario de conexión a PostgreSQL e inspección de esquema/tablas | Formulario de conexión, test de conexión, extractor de columnas |
| **Fase 3** | Carga y procesador de archivos Shapefile / GeoJSON | Componente de upload `.zip` / `.shp` e inspección de campos |
| **Fase 4** | Motor de correlación, normalización de SUID y comparación de atributos | Algoritmos `clean_suid_series`, emparejamiento y detección de diffs |
| **Fase 5** | Comparador de geometrías espaciales y visor de mapas interactivo | Capa Leaflet con resalte cromático de discrepancias |
| **Fase 6** | Generador de reportes CSV y parches SQL PostGIS | Exportador CSV y descargador de scripts SQL `.sql` |
