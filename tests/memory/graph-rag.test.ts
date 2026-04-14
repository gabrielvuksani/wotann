import { describe, it, expect } from "vitest";
import { KnowledgeGraph, extractEntities } from "../../src/memory/graph-rag.js";

describe("Graph RAG", () => {
  describe("extractEntities", () => {
    it("extracts function declarations", () => {
      const text = "function calculateSum(a, b) { return a + b; }";
      const { entities } = extractEntities(text);
      const funcEntity = entities.find((e) => e.name === "calculateSum");
      expect(funcEntity).toBeDefined();
      expect(funcEntity!.type).toBe("function");
    });

    it("extracts class declarations", () => {
      const text = "class UserService extends BaseService { }";
      const { entities } = extractEntities(text);
      const classEntity = entities.find((e) => e.name === "UserService");
      expect(classEntity).toBeDefined();
      expect(classEntity!.type).toBe("class");
    });

    it("extracts interface declarations", () => {
      const text = "interface QueryResult { readonly data: string; }";
      const { entities } = extractEntities(text);
      const iface = entities.find((e) => e.name === "QueryResult");
      expect(iface).toBeDefined();
      expect(iface!.type).toBe("class");
    });

    it("extracts import relationships", () => {
      const text = 'import { foo } from "./utils.js";';
      const { relationships } = extractEntities(text);
      const importRel = relationships.find((r) => r.type === "imports");
      expect(importRel).toBeDefined();
      expect(importRel!.target).toBe("./utils.js");
    });

    it("extracts extends relationships", () => {
      const text = "class Dog extends Animal { }";
      const { relationships } = extractEntities(text);
      const extendsRel = relationships.find((r) => r.type === "extends");
      expect(extendsRel).toBeDefined();
      expect(extendsRel!.target).toBe("Animal");
    });

    it("filters common keywords", () => {
      const text = "const if = true; const else = false;";
      const { entities } = extractEntities(text);
      const kwEntities = entities.filter(
        (e) => e.name === "if" || e.name === "else",
      );
      expect(kwEntities).toHaveLength(0);
    });

    it("extracts concepts from all-caps identifiers", () => {
      const text = "The RAG pipeline uses TF_IDF scoring.";
      const { entities } = extractEntities(text);
      const concepts = entities.filter((e) => e.type === "concept");
      expect(concepts.some((c) => c.name === "RAG")).toBe(true);
      expect(concepts.some((c) => c.name === "TF_IDF")).toBe(true);
    });
  });

  describe("KnowledgeGraph", () => {
    it("starts empty", () => {
      const graph = new KnowledgeGraph();
      expect(graph.getEntityCount()).toBe(0);
      expect(graph.getRelationshipCount()).toBe(0);
      expect(graph.getDocumentCount()).toBe(0);
    });

    it("adds a document and extracts entities", () => {
      const graph = new KnowledgeGraph();
      const code = `
        class MemoryStore {
          function search(query) { return []; }
        }
      `;
      const doc = graph.addDocument("doc-1", code);
      expect(doc.id).toBe("doc-1");
      expect(graph.getEntityCount()).toBeGreaterThan(0);
      expect(graph.getDocumentCount()).toBe(1);
    });

    it("deduplicates entities with same name and type", () => {
      const graph = new KnowledgeGraph();
      graph.addDocument("doc-1", "class Foo { }");
      graph.addDocument("doc-2", "class Foo { }");
      // Same class name should be deduplicated
      const allEntities = graph.getAllEntities();
      const fooEntities = allEntities.filter((e) => e.name === "Foo" && e.type === "class");
      expect(fooEntities).toHaveLength(1);
    });

    it("creates relationships between co-occurring entities", () => {
      const graph = new KnowledgeGraph();
      graph.addDocument("doc-1", `
        class UserStore { }
        class UserService extends UserStore { }
      `);
      expect(graph.getRelationshipCount()).toBeGreaterThan(0);
    });

    it("queries graph by entity name", () => {
      const graph = new KnowledgeGraph();
      graph.addDocument("doc-1", "class MemoryStore { }");
      graph.addDocument("doc-2", "function searchMemory() { }");

      const result = graph.queryGraph("MemoryStore", 1);
      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.entities.some((e) => e.name === "MemoryStore")).toBe(true);
    });

    it("returns empty results for unknown queries", () => {
      const graph = new KnowledgeGraph();
      graph.addDocument("doc-1", "class Foo { }");

      const result = graph.queryGraph("nonexistent_thing_xyz", 1);
      expect(result.entities).toHaveLength(0);
      expect(result.score).toBe(0);
    });

    it("traverses multi-hop relationships", () => {
      const graph = new KnowledgeGraph();
      graph.addDocument("doc-1", `
        class BaseStore { }
        class MemoryStore extends BaseStore { }
      `);
      graph.addDocument("doc-2", `
        class MemoryStore { }
        function queryMemory() { }
      `);

      const result = graph.queryGraph("BaseStore", 2);
      expect(result.entities.length).toBeGreaterThanOrEqual(1);
    });

    it("performs keyword search", () => {
      const graph = new KnowledgeGraph();
      graph.addDocument("doc-1", "class UserService { }");
      graph.addDocument("doc-2", "function getUserById() { }");

      const results = graph.keywordSearch("user");
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.entityName.toLowerCase().includes("user"))).toBe(true);
    });

    it("returns empty keyword search for no matches", () => {
      const graph = new KnowledgeGraph();
      graph.addDocument("doc-1", "class Foo { }");

      const results = graph.keywordSearch("nonexistent");
      expect(results).toHaveLength(0);
    });

    it("performs dual-level retrieval", () => {
      const graph = new KnowledgeGraph();
      graph.addDocument("doc-1", "class MemoryStore { function search() { } }");

      const result = graph.dualLevelRetrieval("MemoryStore");
      expect(result.combinedScore).toBeGreaterThanOrEqual(0);
      expect(result.graphResults).toBeDefined();
      expect(result.keywordResults).toBeDefined();
    });

    it("serializes and deserializes via JSON", () => {
      const graph = new KnowledgeGraph();
      graph.addDocument("doc-1", "class FooBar { }");

      const json = graph.toJSON();
      const restored = KnowledgeGraph.fromJSON(json);

      expect(restored.getEntityCount()).toBe(graph.getEntityCount());
      expect(restored.getRelationshipCount()).toBe(graph.getRelationshipCount());
      expect(restored.getDocumentCount()).toBe(graph.getDocumentCount());
    });

    it("restored graph supports queries", () => {
      const graph = new KnowledgeGraph();
      graph.addDocument("doc-1", "class Widget { }");

      const json = graph.toJSON();
      const restored = KnowledgeGraph.fromJSON(json);

      const result = restored.queryGraph("Widget", 1);
      expect(result.entities.some((e) => e.name === "Widget")).toBe(true);
    });
  });
});
