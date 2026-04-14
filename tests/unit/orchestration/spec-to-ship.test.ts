import { describe, it, expect } from "vitest";
import {
  SpecToShipPipeline,
  type TaskExecutor,
  type PipelineTask,
} from "../../../src/orchestration/spec-to-ship.js";

describe("SpecToShipPipeline", () => {
  const pipeline = new SpecToShipPipeline();

  describe("parseSpec", () => {
    it("extracts title from markdown heading", () => {
      const spec = "# User Auth Feature\n\nImplement OAuth2 login.\n";
      const parsed = pipeline.parseSpec(spec);
      expect(parsed.title).toBe("User Auth Feature");
    });

    it("extracts description from body", () => {
      const spec = "# Feature\n\nThis is the description of the feature.\n";
      const parsed = pipeline.parseSpec(spec);
      expect(parsed.description).toContain("description of the feature");
    });

    it("extracts requirements from bullet points under Requirements heading", () => {
      const spec = [
        "# Feature",
        "Description here.",
        "## Requirements",
        "- Must support SSO login",
        "- Should have rate limiting",
        "- Could add MFA support",
        "## Acceptance Criteria",
        "- Login works end-to-end",
      ].join("\n");

      const parsed = pipeline.parseSpec(spec);
      expect(parsed.requirements.length).toBe(3);
      expect(parsed.requirements[0]?.priority).toBe("must");
      expect(parsed.requirements[1]?.priority).toBe("should");
      expect(parsed.requirements[2]?.priority).toBe("could");
    });

    it("extracts acceptance criteria", () => {
      const spec = [
        "# Feature",
        "## Acceptance Criteria",
        "- All tests pass",
        "- No regressions",
      ].join("\n");

      const parsed = pipeline.parseSpec(spec);
      expect(parsed.acceptanceCriteria.length).toBe(2);
    });

    it("extracts dependencies", () => {
      const spec = [
        "# Feature",
        "## Dependencies",
        "- zod for validation",
        "- better-sqlite3 for storage",
      ].join("\n");

      const parsed = pipeline.parseSpec(spec);
      expect(parsed.dependencies.length).toBe(2);
    });

    it("falls back to bullet points when no Requirements heading", () => {
      const spec = "# Simple\n- Do thing A\n- Do thing B\n";
      const parsed = pipeline.parseSpec(spec);
      expect(parsed.requirements.length).toBe(2);
    });

    it("handles empty spec", () => {
      const parsed = pipeline.parseSpec("");
      expect(parsed.title).toBe("Untitled Spec");
      expect(parsed.requirements.length).toBe(0);
    });
  });

  describe("planFromSpec", () => {
    it("generates all 5 phases", () => {
      const spec = pipeline.parseSpec(
        "# Feature\n## Requirements\n- Must do X\n- Should do Y\n",
      );
      const plan = pipeline.planFromSpec(spec);

      const phaseNames = plan.phases.map((p) => p.phase);
      expect(phaseNames).toContain("research");
      expect(phaseNames).toContain("implement");
      expect(phaseNames).toContain("test");
      expect(phaseNames).toContain("review");
      expect(phaseNames).toContain("ship");
    });

    it("creates implementation tasks per requirement", () => {
      const spec = pipeline.parseSpec(
        "# Feature\n## Requirements\n- Must A\n- Should B\n- Could C\n",
      );
      const plan = pipeline.planFromSpec(spec);

      const implPhase = plan.phases.find((p) => p.phase === "implement");
      expect(implPhase?.tasks.length).toBe(3);
    });

    it("excludes wont requirements from implementation", () => {
      const spec = pipeline.parseSpec(
        "# Feature\n## Requirements\n- Must do X\n- Won't do Y (deferred)\n",
      );
      const plan = pipeline.planFromSpec(spec);

      const implPhase = plan.phases.find((p) => p.phase === "implement");
      // "Won't do Y" should be excluded
      expect(implPhase?.tasks.length).toBe(1);
    });

    it("computes total tasks and estimated minutes", () => {
      const spec = pipeline.parseSpec(
        "# Feature\n## Requirements\n- Must do A\n",
      );
      const plan = pipeline.planFromSpec(spec);

      expect(plan.totalTasks).toBeGreaterThan(0);
      expect(plan.estimatedMinutes).toBeGreaterThan(0);
    });

    it("sets up task dependencies across phases", () => {
      const spec = pipeline.parseSpec(
        "# Feature\n## Requirements\n- Must do A\n",
      );
      const plan = pipeline.planFromSpec(spec);

      const testPhase = plan.phases.find((p) => p.phase === "test");
      const testTask = testPhase?.tasks[0];
      // Test tasks should depend on implementation tasks
      expect(testTask?.dependsOn.length).toBeGreaterThan(0);
    });
  });

  describe("executePlan", () => {
    const successExecutor: TaskExecutor = {
      executeTask: async (task: PipelineTask) => ({
        taskId: task.id,
        success: true,
        output: `Completed: ${task.description}`,
        durationMs: 100,
      }),
    };

    const failExecutor: TaskExecutor = {
      executeTask: async (task: PipelineTask) => ({
        taskId: task.id,
        success: false,
        output: "Failed",
        durationMs: 50,
      }),
    };

    it("executes all tasks with successful executor", async () => {
      const spec = pipeline.parseSpec(
        "# Feature\n## Requirements\n- Must do A\n",
      );
      const plan = pipeline.planFromSpec(spec);

      const result = await pipeline.executePlan(plan, successExecutor);
      expect(result.success).toBe(true);
      expect(result.completedTasks).toBe(plan.totalTasks);
      expect(result.failedTasks).toBe(0);
      expect(result.results.length).toBe(plan.totalTasks);
    });

    it("reports failed tasks correctly", async () => {
      const spec = pipeline.parseSpec("# Feature\n- Must do A\n");
      const plan = pipeline.planFromSpec(spec);

      const result = await pipeline.executePlan(plan, failExecutor);
      expect(result.success).toBe(false);
      expect(result.failedTasks).toBeGreaterThan(0);
    });

    it("skips tasks when dependencies fail", async () => {
      // Use a mixed executor that fails research tasks
      let callCount = 0;
      const mixedExecutor: TaskExecutor = {
        executeTask: async (task: PipelineTask) => {
          callCount++;
          return {
            taskId: task.id,
            success: task.phase === "research" ? false : true,
            output: task.phase === "research" ? "Failed" : "Done",
            durationMs: 10,
          };
        },
      };

      const spec = pipeline.parseSpec("# Feature\n- Must do A\n");
      const plan = pipeline.planFromSpec(spec);

      const result = await pipeline.executePlan(plan, mixedExecutor);
      expect(result.skippedTasks).toBeGreaterThan(0);
    });

    it("tracks execution duration", async () => {
      const spec = pipeline.parseSpec("# Feature\n- Must do A\n");
      const plan = pipeline.planFromSpec(spec);

      const result = await pipeline.executePlan(plan, successExecutor);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getProgress", () => {
    it("starts at 0%", () => {
      const freshPipeline = new SpecToShipPipeline();
      const progress = freshPipeline.getProgress();
      expect(progress.percentComplete).toBe(0);
      expect(progress.currentTaskIndex).toBe(0);
    });

    it("updates during execution", async () => {
      const executingPipeline = new SpecToShipPipeline();
      const spec = executingPipeline.parseSpec("# Feature\n- Must do A\n");
      const plan = executingPipeline.planFromSpec(spec);

      const executor: TaskExecutor = {
        executeTask: async (task: PipelineTask) => ({
          taskId: task.id,
          success: true,
          output: "Done",
          durationMs: 10,
        }),
      };

      await executingPipeline.executePlan(plan, executor);

      const progress = executingPipeline.getProgress();
      expect(progress.percentComplete).toBe(100);
      expect(progress.completedPhases.length).toBe(5);
    });
  });
});
