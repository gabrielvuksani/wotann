import { describe, it, expect } from "vitest";
import {
  KnowledgeConnectorRegistry,
  GoogleDriveConnector,
  NotionConnector,
  ConfluenceConnector,
  JiraConnector,
  createConnector,
  createDefaultRegistry,
} from "../../src/channels/knowledge-connectors.js";

describe("KnowledgeConnectorRegistry", () => {
  it("starts empty", () => {
    const registry = new KnowledgeConnectorRegistry();
    expect(registry.getConnectorCount()).toBe(0);
    expect(registry.getAllConnectors()).toHaveLength(0);
  });

  it("registers and retrieves connectors", () => {
    const registry = new KnowledgeConnectorRegistry();
    const connector = new GoogleDriveConnector();

    registry.register(connector);

    expect(registry.getConnectorCount()).toBe(1);
    expect(registry.getConnector("google-drive")).toBeDefined();
  });

  it("unregisters connectors", () => {
    const registry = new KnowledgeConnectorRegistry();
    registry.register(new GoogleDriveConnector());
    registry.register(new NotionConnector());

    registry.unregister("google-drive");

    expect(registry.getConnectorCount()).toBe(1);
    expect(registry.getConnector("google-drive")).toBeUndefined();
  });

  it("filters connectors by type", () => {
    const registry = new KnowledgeConnectorRegistry();
    registry.register(new GoogleDriveConnector());
    registry.register(new NotionConnector());
    registry.register(new JiraConnector());

    const jiraConnectors = registry.getConnectorsByType("jira");
    expect(jiraConnectors).toHaveLength(1);
    expect(jiraConnectors[0]?.type).toBe("jira");
  });

  it("returns only connected connectors", () => {
    const registry = new KnowledgeConnectorRegistry();
    const drive = new GoogleDriveConnector();
    const notion = new NotionConnector();

    registry.register(drive);
    registry.register(notion);

    // Neither is connected yet
    expect(registry.getConnectedConnectors()).toHaveLength(0);
  });

  it("searches across connected connectors (returns empty when none connected)", async () => {
    const registry = new KnowledgeConnectorRegistry();
    registry.register(new GoogleDriveConnector());

    const results = await registry.searchAll("test query");
    expect(results).toHaveLength(0);
  });
});

describe("GoogleDriveConnector", () => {
  it("has correct id, type, and name", () => {
    const connector = new GoogleDriveConnector();
    expect(connector.id).toBe("google-drive");
    expect(connector.type).toBe("google-drive");
    expect(connector.name).toBe("Google Drive");
  });

  it("reports disconnected initially", () => {
    const connector = new GoogleDriveConnector();
    expect(connector.isConnected()).toBe(false);
  });

  it("connects with provided API key", async () => {
    const connector = new GoogleDriveConnector();
    await connector.connect({ apiKey: "test-key" });
    expect(connector.isConnected()).toBe(true);
  });

  it("throws on connect without API key", async () => {
    const connector = new GoogleDriveConnector();
    await expect(connector.connect({})).rejects.toThrow("GOOGLE_DRIVE_API_KEY");
  });

  it("throws on search when not connected", async () => {
    const connector = new GoogleDriveConnector();
    await expect(connector.search("test")).rejects.toThrow("not connected");
  });

  it("returns stub results when connected", async () => {
    const connector = new GoogleDriveConnector();
    await connector.connect({ apiKey: "test-key" });

    const results = await connector.search("documents");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.document.source).toBe("google-drive");
  });

  it("ingest returns empty array (stub)", async () => {
    const connector = new GoogleDriveConnector();
    await connector.connect({ apiKey: "test-key" });

    const docs = await connector.ingest();
    expect(docs).toHaveLength(0);
  });
});

describe("NotionConnector", () => {
  it("has correct id, type, and name", () => {
    const connector = new NotionConnector();
    expect(connector.id).toBe("notion");
    expect(connector.type).toBe("notion");
    expect(connector.name).toBe("Notion");
  });

  it("reports disconnected initially", () => {
    expect(new NotionConnector().isConnected()).toBe(false);
  });

  it("connects with provided API key", async () => {
    const connector = new NotionConnector();
    await connector.connect({ apiKey: "test-notion-key" });
    expect(connector.isConnected()).toBe(true);
  });

  it("throws on connect without API key", async () => {
    const connector = new NotionConnector();
    await expect(connector.connect({})).rejects.toThrow("NOTION_API_KEY");
  });

  it("returns stub results when connected", async () => {
    const connector = new NotionConnector();
    await connector.connect({ apiKey: "test-key" });

    const results = await connector.search("pages");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.document.source).toBe("notion");
  });
});

describe("ConfluenceConnector", () => {
  it("has correct id, type, and name", () => {
    const connector = new ConfluenceConnector();
    expect(connector.id).toBe("confluence");
    expect(connector.type).toBe("confluence");
    expect(connector.name).toBe("Confluence");
  });

  it("reports disconnected initially", () => {
    expect(new ConfluenceConnector().isConnected()).toBe(false);
  });

  it("connects with API key and base URL", async () => {
    const connector = new ConfluenceConnector();
    await connector.connect({
      apiKey: "test-token",
      baseUrl: "https://company.atlassian.net/wiki",
    });
    expect(connector.isConnected()).toBe(true);
  });

  it("throws on connect without API key", async () => {
    const connector = new ConfluenceConnector();
    await expect(connector.connect({})).rejects.toThrow("CONFLUENCE_API_TOKEN");
  });

  it("throws on connect without base URL", async () => {
    const connector = new ConfluenceConnector();
    await expect(
      connector.connect({ apiKey: "token" }),
    ).rejects.toThrow("CONFLUENCE_BASE_URL");
  });

  it("returns stub results when connected", async () => {
    const connector = new ConfluenceConnector();
    await connector.connect({
      apiKey: "token",
      baseUrl: "https://company.atlassian.net/wiki",
    });

    const results = await connector.search("architecture docs");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.document.source).toBe("confluence");
  });
});

describe("JiraConnector", () => {
  it("has correct id, type, and name", () => {
    const connector = new JiraConnector();
    expect(connector.id).toBe("jira");
    expect(connector.type).toBe("jira");
    expect(connector.name).toBe("Jira");
  });

  it("reports disconnected initially", () => {
    expect(new JiraConnector().isConnected()).toBe(false);
  });

  it("connects with API key and base URL", async () => {
    const connector = new JiraConnector();
    await connector.connect({
      apiKey: "test-token",
      baseUrl: "https://company.atlassian.net",
    });
    expect(connector.isConnected()).toBe(true);
  });

  it("throws on connect without API key", async () => {
    const connector = new JiraConnector();
    await expect(connector.connect({})).rejects.toThrow("JIRA_API_TOKEN");
  });

  it("throws on connect without base URL", async () => {
    const connector = new JiraConnector();
    await expect(
      connector.connect({ apiKey: "token" }),
    ).rejects.toThrow("JIRA_BASE_URL");
  });

  it("returns stub results when connected", async () => {
    const connector = new JiraConnector();
    await connector.connect({
      apiKey: "token",
      baseUrl: "https://company.atlassian.net",
    });

    const results = await connector.search("bug tickets");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.document.source).toBe("jira");
  });
});

describe("createConnector factory", () => {
  it("creates GoogleDriveConnector", () => {
    const connector = createConnector("google-drive");
    expect(connector.type).toBe("google-drive");
  });

  it("creates NotionConnector", () => {
    const connector = createConnector("notion");
    expect(connector.type).toBe("notion");
  });

  it("creates ConfluenceConnector", () => {
    const connector = createConnector("confluence");
    expect(connector.type).toBe("confluence");
  });

  it("creates JiraConnector", () => {
    const connector = createConnector("jira");
    expect(connector.type).toBe("jira");
  });
});

describe("createDefaultRegistry", () => {
  it("creates registry with all 4 connector types", () => {
    const registry = createDefaultRegistry();

    expect(registry.getConnectorCount()).toBe(4);
    expect(registry.getConnector("google-drive")).toBeDefined();
    expect(registry.getConnector("notion")).toBeDefined();
    expect(registry.getConnector("confluence")).toBeDefined();
    expect(registry.getConnector("jira")).toBeDefined();
  });
});
