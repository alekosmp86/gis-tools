/**
 * File contents used for file uploads in tests (CSV, GeoJSON).
 */

export const SAMPLE_CSV_CONTENT = `suid,departamento,codigo,area
PAD-001,MONTEVIDEO,A1,100
PAD-002,CANELONES,B2_MODIFIED,250
PAD-004,ROCHA,D4,500
`;

export const SAMPLE_GEOJSON_CONTENT = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-56.1, -34.9],
            [-56.1, -34.8],
            [-56.0, -34.8],
            [-56.0, -34.9],
            [-56.1, -34.9],
          ],
        ],
      },
      properties: {
        suid: "PAD-001",
        departamento: "MONTEVIDEO",
        codigo: "A1",
        area: 100,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-56.2, -34.9],
            [-56.2, -34.8],
            [-56.1, -34.8],
            [-56.1, -34.9],
            [-56.2, -34.9],
          ],
        ],
      },
      properties: {
        suid: "PAD-002",
        departamento: "CANELONES",
        codigo: "B2_MODIFIED",
        area: 250,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-56.3, -34.9],
            [-56.3, -34.8],
            [-56.2, -34.8],
            [-56.2, -34.9],
            [-56.3, -34.9],
          ],
        ],
      },
      properties: {
        suid: "PAD-004",
        departamento: "ROCHA",
        codigo: "D4",
        area: 500,
      },
    },
  ],
});
