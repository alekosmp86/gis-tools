import type { SigraLayerId } from "../constants";
import type { DbConnection } from "../../types";
import type { LayerLoadResult, LoadLayerOptions, SigraDbState } from "../types";

export interface SigraLayersRepository {
  inspect(connection: DbConnection, layerIds: ReadonlyArray<SigraLayerId>): Promise<SigraDbState>;
  loadLayer(connection: DbConnection, layerId: SigraLayerId, options: LoadLayerOptions): Promise<LayerLoadResult>;
}
