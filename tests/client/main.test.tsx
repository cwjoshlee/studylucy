// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const bootstrap = vi.hoisted(() => ({
  api: { marker: "production-api" },
  createProductionApi: vi.fn(),
  render: vi.fn()
}));

vi.mock("../../src/client/api/production", () => ({
  createProductionApi: bootstrap.createProductionApi
}));
vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => ({ render: bootstrap.render }))
}));
vi.mock("../../src/client/offline/sync", () => ({
  syncPending: vi.fn()
}));

describe("production bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    bootstrap.createProductionApi.mockReset();
    bootstrap.createProductionApi.mockReturnValue(bootstrap.api);
    bootstrap.render.mockReset();
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("constructs the application API through the production authority factory", async () => {
    await import("../../src/client/main");

    expect(bootstrap.createProductionApi).toHaveBeenCalledOnce();
    expect(bootstrap.render).toHaveBeenCalledOnce();
  });
});
