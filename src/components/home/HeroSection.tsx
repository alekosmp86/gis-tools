import React from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "../ui/Badge";
import styles from "./HeroSection.module.css";

export const HeroSection: React.FC = () => {
  return (
    <section className={styles.hero}>
      <div className={styles.heroTag}>
        <Badge variant="active">
          <Sparkles size={12} /> Herramientas de Ingeniería Espacial
        </Badge>
      </div>

      <h1 className={styles.title}>
        Sistemas de Información <br />
        <span className="text-gradient-cyan">Geográfica (SIG)</span>
      </h1>

      <p className={styles.description}>
        Una suite de alto rendimiento para correlacionar conjuntos de datos espaciales,
        detectar discrepancias de atributos y geometría entre bases de datos y archivos Shapefile,
        y exportar parches de actualización PostGIS.
      </p>
    </section>
  );
};
