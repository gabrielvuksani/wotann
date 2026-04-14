import { describe, it, expect } from "vitest";
import { GraphBuilder, executeGraph } from "../../src/orchestration/graph-dsl.js";

describe("Graph DSL", () => {
  describe("GraphBuilder", () => {
    it("builds a chain of nodes", () => {
      const builder = new GraphBuilder();
      builder
        .addNode({ id: "a", type: "task", label: "Task A" })
        .addNode({ id: "b", type: "task", label: "Task B" })
        .addNode({ id: "c", type: "task", label: "Task C" })
        .chain("a", "b", "c");

      const graph = builder.build();
      expect(graph.nodes).toHaveLength(3);
      expect(graph.edges).toHaveLength(2);
      expect(graph.entryNode).toBe("a");
    });

    it("builds fanout topology", () => {
      const builder = new GraphBuilder();
      builder
        .addNode({ id: "src", type: "task", label: "Source" })
        .addNode({ id: "w1", type: "task", label: "Worker 1" })
        .addNode({ id: "w2", type: "task", label: "Worker 2" })
        .fanout("src", ["w1", "w2"]);

      const graph = builder.build();
      const fanoutEdges = graph.edges.filter((e) => e.from.includes("fanout"));
      expect(fanoutEdges).toHaveLength(2);
    });

    it("supports on_failure strategies", () => {
      const builder = new GraphBuilder();
      builder
        .addNode({ id: "risky", type: "task", label: "Risky Task" })
        .onFailure("risky", "retry");

      const graph = builder.build();
      const riskyNode = graph.nodes.find((n) => n.id === "risky");
      expect(riskyNode?.onFailure).toBe("retry");
    });
  });

  describe("executeGraph", () => {
    it("executes chain in order", async () => {
      const order: string[] = [];
      const builder = new GraphBuilder();
      builder
        .addNode({ id: "a", type: "task", label: "A" })
        .addNode({ id: "b", type: "task", label: "B" })
        .chain("a", "b");

      const results = await executeGraph(builder.build(), async (node) => {
        order.push(node.id);
        return { success: true, output: `done-${node.id}` };
      });

      expect(order).toEqual(["a", "b"]);
      expect(results.some((r) => r.nodeId === "a" && r.status === "success")).toBe(true);
    });

    it("handles node failure with skip strategy", async () => {
      const builder = new GraphBuilder();
      builder
        .addNode({ id: "fail", type: "task", label: "Fail", onFailure: "skip", maxRetries: 1 })
        .chain("fail");

      const results = await executeGraph(builder.build(), async () => {
        return { success: false, output: "error" };
      });

      const failResult = results.find((r) => r.nodeId === "fail");
      expect(failResult).toBeDefined();
    });
  });
});
