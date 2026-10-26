---
title: "Trabajos de rutina"
order: 1
---

# Trabajos de rutina

Esta herramienta reúne los trabajos de base de datos que se repiten, como la carga mensual de un padrón. Cada trabajo tiene su propio asistente de pasos: usted configura la carga, revisa el resumen y, al terminar, recibe un informe.

Se abre desde el portal, en la tarjeta **Trabajos de rutina**, o desde el menú como **Trabajos de rutina**. La página lista los trabajos disponibles; con **Abrir** se entra al asistente del trabajo y con **Volver a la lista** se regresa.

## Trabajos disponibles

| Trabajo | Qué hace |
|---|---|
| [Cargar padrones](cargar-padrones.md) | Carga el padrón a partir de las tablas rural y urbana, ya cargadas con la sincronización de shapefiles. |

## Antes de empezar

Las tablas de origen (rural y urbana) tienen que estar cargadas en la base antes de ejecutar un trabajo. Para eso se usa la herramienta de sincronización de shapefiles en modo de reemplazo.

## Cómo se usa un trabajo

Todos los trabajos siguen los mismos cinco pasos: **Conexión**, **Tablas**, **Opciones**, **Revisar** y **Resultado**. Puede volver a un paso anterior en cualquier momento haciendo clic en su número en la barra superior, o con el botón **Volver al Paso** del pie de cada paso. Antes de cargar datos, el paso **Revisar** le muestra el resumen completo y le permite hacer un análisis sin modificar nada.
