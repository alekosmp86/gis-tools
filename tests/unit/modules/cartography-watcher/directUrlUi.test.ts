import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddSourceForm } from "@/modules/cartography-watcher/ui/AddSourceForm";
import { EditSourceForm } from "@/modules/cartography-watcher/ui/EditSourceForm";
import { SourceStatusBadge } from "@/modules/cartography-watcher/ui/SourceStatusBadge";
import { WatchedSourceCard } from "@/modules/cartography-watcher/ui/WatchedSourceCard";
import { addSource, updateSource } from "@/modules/cartography-watcher/ui/watcherClient";
import { MISSING_PRJ_WARNING, ON_DEMAND_LABEL } from "@/modules/cartography-watcher/constants";
import { SourceBadgeState, WatchedSourceKind } from "@/modules/cartography-watcher/types";
import type { WatchedSource } from "@/modules/cartography-watcher/types";

const ANEP_URL = "https://mapas.ide.uy/geoserver-vectorial/x/wfs?typeName=centros_anep_2";

function directSource(overrides: Partial<WatchedSource> = {}): WatchedSource {
  return {
    id: "centros_anep",
    title: "Centros ANEP",
    datasetSlug: "centros_anep",
    portalHost: "mapas.ide.uy",
    isDefault: false,
    kind: WatchedSourceKind.DIRECT_URL,
    directUrl: ANEP_URL,
    ...overrides,
  };
}

function ckanSource(overrides: Partial<WatchedSource> = {}): WatchedSource {
  return {
    id: "ejes",
    title: "Ejes",
    datasetSlug: "ide-ejes",
    portalHost: "catalogodatos.gub.uy",
    isDefault: false,
    ...overrides,
  };
}

function renderCard(source: WatchedSource, summary?: Parameters<typeof WatchedSourceCard>[0]["summary"]) {
  return renderToStaticMarkup(
    React.createElement(WatchedSourceCard, {
      source,
      summary,
      isRemoving: false,
      isUpdating: false,
      onUpdate: async () => undefined,
      onRemove: () => undefined,
    })
  );
}

describe("AddSourceForm", () => {
  function render() {
    return renderToStaticMarkup(
      React.createElement(AddSourceForm, {
        isSubmitting: false,
        onSubmit: async () => [],
      })
    );
  }

  it("should offer the Conjunto CKAN and URL directa kinds", () => {
    const html = render();

    expect(html).toContain("Conjunto CKAN");
    expect(html).toContain("URL directa");
    expect(html).toContain('value="ckan"');
    expect(html).toContain('value="direct-url"');
  });

  it("should default to CKAN: no title field and the CKAN placeholder", () => {
    const html = render();

    expect(html).not.toContain('aria-label="Título"');
    expect(html).toContain("catalogodatos.gub.uy/dataset");
  });

  it("should select the CKAN option by default", () => {
    expect(render()).toMatch(/<option value="ckan" selected=""/);
  });

  it("should show the verifying label and disable inputs while submitting", () => {
    const html = renderToStaticMarkup(
      React.createElement(AddSourceForm, { isSubmitting: true, onSubmit: async () => [] })
    );

    expect(html).toContain("Verificando...");
    expect(html).toContain("disabled");
  });
});

describe("EditSourceForm", () => {
  function render(props: { initialTitle?: string; initialUrl: string }) {
    return renderToStaticMarkup(
      React.createElement(EditSourceForm, {
        ...props,
        isSubmitting: false,
        onSubmit: async () => undefined,
        onCancel: () => undefined,
      })
    );
  }

  it("should show Título and URL fields prefilled for a direct source", () => {
    const html = render({ initialTitle: "Centros ANEP", initialUrl: ANEP_URL });

    expect(html).toContain(">Título<");
    expect(html).toContain(">URL<");
    expect(html).toContain('value="Centros ANEP"');
    expect(html).toContain(`value="${ANEP_URL}"`);
    expect(html).toContain("Guardar");
    expect(html).toContain("Cancelar");
  });

  it("should show only the catalogue reference field for a CKAN source", () => {
    const html = render({ initialUrl: "https://catalogodatos.gub.uy/dataset/x" });

    expect(html).not.toContain(">Título<");
    expect(html).toContain("URL o identificador del catálogo");
  });
});

describe("WatchedSourceCard", () => {
  it("should show title, host, on-demand label, Editar and Eliminar for a direct source", () => {
    const html = renderCard(directSource());

    expect(html).toContain("Centros ANEP");
    expect(html).toContain("mapas.ide.uy");
    expect(html).toContain(ON_DEMAND_LABEL);
    expect(html).toContain("Editar");
    expect(html).toContain("Eliminar");
  });

  it("should show no vault, update or portal information for a direct source", () => {
    const html = renderCard(directSource());

    expect(html).not.toContain("Recursos");
    expect(html).not.toContain("Novedades");
    expect(html).not.toContain("Última consulta");
    expect(html).not.toContain("Ver en el portal");
    expect(html).not.toContain("Consultando...");
    expect(html).not.toContain("Dejar de vigilar");
  });

  it("should show the stored .prj warning on the card", () => {
    const html = renderCard(directSource({ warnings: [MISSING_PRJ_WARNING] }));

    expect(html).toContain(MISSING_PRJ_WARNING);
  });

  it("should show no warning when the source has none", () => {
    expect(renderCard(directSource())).not.toContain("Sin archivo .prj");
  });

  it("should not hide Eliminar for a direct source (never a default)", () => {
    expect(renderCard(directSource({ isDefault: false }))).toContain("Eliminar");
  });

  it("should keep the CKAN card with metrics, portal link and Dejar de vigilar", () => {
    const html = renderCard(ckanSource(), {
      sourceId: "ejes",
      datasetSlug: "ide-ejes",
      title: "Ejes",
      status: SourceBadgeState.UP_TO_DATE,
      totalResources: 4,
      pendingCount: 0,
      checkedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(html).toContain("Recursos");
    expect(html).toContain("Ver en el portal");
    expect(html).toContain("Dejar de vigilar");
    expect(html).not.toContain(ON_DEMAND_LABEL);
  });

  it("should hide the remove button on a default CKAN source", () => {
    const html = renderCard(ckanSource({ isDefault: true }));

    expect(html).toContain("Editar");
    expect(html).not.toContain("Dejar de vigilar");
  });
});

describe("SourceStatusBadge", () => {
  it("should render the ON_DEMAND badge with 'Se descarga en cada uso'", () => {
    const html = renderToStaticMarkup(
      React.createElement(SourceStatusBadge, { status: SourceBadgeState.ON_DEMAND })
    );

    expect(html).toContain("Se descarga en cada uso");
  });

  it.each(Object.values(SourceBadgeState))("should render a label for state %s", (status) => {
    const html = renderToStaticMarkup(React.createElement(SourceStatusBadge, { status }));

    expect(html).toContain("<span");
    expect(html.length).toBeGreaterThan(20);
  });
});

describe("watcherClient requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(payload: unknown = { success: true, sources: [] }) {
    const fetchMock = vi.fn(async () => Response.json(payload));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function sentBody(fetchMock: ReturnType<typeof stubFetch>): Record<string, unknown> {
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    return JSON.parse(init.body as string);
  }

  it("should post a direct-url add with kind, title and url", async () => {
    const fetchMock = stubFetch();

    await addSource({ kind: WatchedSourceKind.DIRECT_URL, title: "Centros", url: ANEP_URL });

    expect(sentBody(fetchMock)).toEqual({ kind: "direct-url", title: "Centros", url: ANEP_URL });
  });

  it("should post a CKAN add with only the url", async () => {
    const fetchMock = stubFetch();

    await addSource({ kind: WatchedSourceKind.CKAN, url: "ide-ejes" });

    expect(sentBody(fetchMock)).toEqual({ url: "ide-ejes" });
  });

  it("should return the warnings of the response, defaulting to an empty list", async () => {
    stubFetch({ success: true, sources: [], warnings: [MISSING_PRJ_WARNING] });
    const withWarnings = await addSource({ kind: WatchedSourceKind.CKAN, url: "x" });
    stubFetch({ success: true, sources: [] });
    const without = await addSource({ kind: WatchedSourceKind.CKAN, url: "x" });

    expect(withWarnings.warnings).toEqual([MISSING_PRJ_WARNING]);
    expect(without.warnings).toEqual([]);
  });

  it("should spread the edit changes next to sourceId on update", async () => {
    const fetchMock = stubFetch();

    await updateSource("centros_anep", { title: "Nuevo" });

    expect(sentBody(fetchMock)).toEqual({ sourceId: "centros_anep", title: "Nuevo" });
  });

  it("should surface the server's Spanish error message on a 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: false, error: "El ZIP no contiene el archivo .dbf del shapefile." }, { status: 500 }))
    );

    await expect(
      addSource({ kind: WatchedSourceKind.DIRECT_URL, title: "t", url: ANEP_URL })
    ).rejects.toThrow("El ZIP no contiene el archivo .dbf del shapefile.");
  });
});
