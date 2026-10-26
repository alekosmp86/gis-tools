---
title: "Decisiones y motivos"
order: 3
---

# Decisiones y motivos

Cada fila del análisis tiene una **decisión** y un **motivo**. La decisión dice si la fila se **conserva** o se **elimina**. El motivo explica por qué.

Las fuentes se tratan así:

- **IDE** es una fuente protegida. Sus filas nunca se eliminan.
- **ANTEL** y **TLK** son las fuentes que pueden eliminarse.

## Cómo se decide

Las reglas se aplican en orden, y la primera que se cumple decide:

1. Si la fila es de IDE, se conserva.
2. Si la fila está vinculada a infraestructura (un servicio o CTO de TLK, o un dispositivo NAP), se conserva.
3. Si ninguna fila del grupo está vinculada, se conserva la de **urn más bajo** entre ANTEL y TLK, y las demás se eliminan.
4. Si hay otra fila de ANTEL o TLK vinculada a infraestructura, la fila no vinculada se elimina.
5. Si la fila tiene **unidades internas** (apartamentos u otras unidades) asociadas, nunca se elimina: se marca para revisar.

Dos reglas dependen de la opción de IDE del análisis:

- Si el grupo tiene una fila de IDE y ninguna fila de ANTEL o TLK está vinculada, la fila de ANTEL o TLK de urn más bajo se conserva con la opción desactivada (motivo *Conservada junto a fuente protegida (revisar)*).
- Con la opción **Eliminar ANTEL/TLK duplicado de una fuente protegida (IDE)** activada, esa misma fila se elimina (motivo *Redundante con fuente protegida*).

## Motivos

| Motivo | Decisión | Qué significa |
|---|---|---|
| **Fuente protegida** | Conservar | La fila es de IDE: nunca se elimina. |
| **Vinculada a infraestructura** | Conservar | La fila está vinculada a un servicio o CTO de TLK, o a un dispositivo NAP. |
| **Sin duplicado** | Conservar | El grupo tiene una sola fila. No aparece en los resultados. |
| **Urn más bajo conservado** | Conservar | Ninguna fila del grupo está vinculada, y esta es la de urn más bajo entre ANTEL y TLK. Se conserva. |
| **Conservada junto a fuente protegida (revisar)** | Conservar | Caso de la regla 3, pero el grupo tiene una fila de IDE. Conviene revisarla antes de eliminar las demás. |
| **Redundante con una vinculada** | Eliminar | Otra fila de ANTEL o TLK del grupo está vinculada a infraestructura. |
| **Redundante (no es el urn más bajo)** | Eliminar | Ninguna fila está vinculada, y esta no es la de urn más bajo. |
| **Redundante con fuente protegida** | Eliminar | La fila duplica una de IDE y no tiene vínculo. Solo ocurre con la opción de IDE activada. |
| **Tiene unidades internas (revisar)** | Conservar | La fila tendría que eliminarse, pero tiene unidades internas asociadas. Eliminarla dejaría esas unidades sin dirección. Se revisa a mano. |

## Filas para revisar

Las filas marcadas como **para revisar** son las que tienen el motivo *Conservada junto a fuente protegida (revisar)* o *Tiene unidades internas (revisar)*. Están en el indicador **Para revisar** del resumen, y se pueden ver con el filtro **Solo para revisar**.

> [!WARNING]
> Las filas para revisar **no se eliminan** nunca desde esta herramienta, ni siquiera en la eliminación confirmada. Decida sobre ellas por fuera, con el criterio de quien administra las direcciones.

## Cómo leer un grupo

Un grupo reúne filas que la herramienta considera la misma dirección, según los campos de la clave de coincidencia. Por ejemplo, dos filas con la misma calle, número y localidad. Para cada grupo:

- revise que las direcciones sean realmente la misma. La clave se ve al pasar el puntero sobre el encabezado del grupo;
- mire los motivos: si todas las filas de ANTEL o TLK son *Redundante*, el grupo tiene una sola fila conservada;
- si aparece algún *(revisar)*, decida esa fila antes de cualquier eliminación.

## Preguntas frecuentes

**¿Por qué se conserva una fila que parece igual a otra?**
Porque la otra tiene un vínculo a infraestructura o es la de urn más bajo. Lea el motivo de cada fila del grupo.

**¿Una fila de IDE puede eliminarse?**
No. IDE es una fuente protegida y no entra en ninguna eliminación.

**¿Qué significa "Redundante con una vinculada"?**
Que hay otra fila de ANTEL o TLK en el mismo grupo que sí está vinculada a infraestructura, y esa es la que se conserva.

**¿Las decisiones pueden cambiar?**
Sí. Dependen de la base en el momento del análisis. Si cambian los datos, o la opción de IDE, vuelva a analizar.

Para la eliminación, ver [Eliminación confirmada](eliminacion.md).
