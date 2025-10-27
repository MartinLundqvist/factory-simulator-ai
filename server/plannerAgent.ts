// plannerAgent.ts - Core planner agent with streaming capabilities

import { EventEmitter } from "events";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { FactorySimulation, SimState, SimParams } from "./FactorySimulation.js";
import {
  PlannerEvent,
  PlannerConfig,
  ParsedObjectives,
  MetricsAnalysis,
  ParameterProposal,
  ValidationResult,
  ExperimentResult,
  GoalProgress,
} from "./plannerTypes.js";
import { readFactoryManual } from "./factoryTools.js";

/**
 * Experiment memory for storing and retrieving past results
 */
class ExperimentMemory {
  private experiments: ExperimentResult[] = [];

  store(experiment: ExperimentResult): void {
    this.experiments.push(experiment);
  }

  getAll(): ExperimentResult[] {
    return [...this.experiments];
  }

  getBest(metric: "throughput" | "cycleTime" | "wip"): ExperimentResult | null {
    if (this.experiments.length === 0) return null;

    return this.experiments.reduce((best, exp) => {
      const bestValue = this.getMetricValue(best.metrics, metric);
      const expValue = this.getMetricValue(exp.metrics, metric);

      // For throughput, higher is better; for cycleTime and wip, lower is better
      if (metric === "throughput") {
        return expValue > bestValue ? exp : best;
      } else {
        return expValue < bestValue ? exp : best;
      }
    });
  }

  private getMetricValue(metrics: MetricsAnalysis, metric: string): number {
    switch (metric) {
      case "throughput":
        return metrics.throughput;
      case "cycleTime":
        return metrics.avgCycleTime;
      case "wip":
        return metrics.avgWip;
      default:
        return 0;
    }
  }

  getRecent(count: number): ExperimentResult[] {
    return this.experiments.slice(-count);
  }

  hasTriedParams(params: Partial<SimParams>): boolean {
    const paramsStr = JSON.stringify(params);
    return this.experiments.some(
      (exp) =>
        JSON.stringify(this.extractChangedParams(exp.params)) === paramsStr
    );
  }

  private extractChangedParams(params: SimParams): Partial<SimParams> {
    // This is a simplified version - in practice, you'd compare with baseline
    return params;
  }

  size(): number {
    return this.experiments.length;
  }

  clear(): void {
    this.experiments = [];
  }
}

/**
 * Main Planner Agent class
 * Orchestrates iterative optimization with LLM reasoning
 */
export class PlannerAgent extends EventEmitter {
  private factory: FactorySimulation;
  private memory: ExperimentMemory;
  private isRunning = false;

  constructor(factory: FactorySimulation) {
    super();
    this.factory = factory;
    this.memory = new ExperimentMemory();
  }

  /**
   * Main optimization loop
   * Emits events at each step for streaming to clients
   */
  async optimize(userGoal: string, config: PlannerConfig): Promise<void> {
    if (this.isRunning) {
      throw new Error("Planner is already running");
    }

    this.isRunning = true;
    this.memory.clear();

    try {
      // Emit start event
      this.emit("planner:start", {
        type: "planner:start",
        goal: userGoal,
        maxIterations: config.maxIterations,
      } as PlannerEvent);

      // Parse goal into structured objectives
      this.emitPhase("parsing_goal", "Parsing optimization goal...");
      console.log("[Planner] Parsing goal:", userGoal);
      const objectives = await this.parseGoal(userGoal);
      console.log("[Planner] Goals parsed:", objectives);
      this.emit("planner:goal_parsed", {
        type: "planner:goal_parsed",
        objectives,
      } as PlannerEvent);
      console.log("[Planner] Goal parsed event emitted");

      // Run baseline simulation to get initial metrics
      this.emitPhase("baseline", "Running baseline simulation...");
      console.log("[Planner] Starting baseline simulation...");
      const baselineResult = await this.runSimulation();
      console.log("[Planner] Baseline simulation complete");
      const baselineMetrics = await this.analyzeMetrics(baselineResult);
      console.log("[Planner] Baseline metrics analyzed:", baselineMetrics);
      this.emit("planner:metrics", {
        type: "planner:metrics",
        metrics: baselineMetrics,
      } as PlannerEvent);

      // Check if goal already achieved
      console.log("[Planner] Evaluating baseline progress...");
      const baselineProgress = this.evaluateGoalProgress(
        baselineMetrics,
        objectives
      );
      console.log("[Planner] Baseline progress:", baselineProgress);
      this.emit("planner:goal_progress", {
        type: "planner:goal_progress",
        progress: baselineProgress,
      } as PlannerEvent);
      console.log("[Planner] Starting main iteration loop...");

      if (config.stopOnGoalAchieved && baselineProgress.overall >= 1.0) {
        this.emit("planner:complete", {
          type: "planner:complete",
          success: true,
          message: "Goal already achieved with current parameters!",
          bestResult: null,
        } as PlannerEvent);
        this.isRunning = false;
        return;
      }

      // Main iteration loop
      for (let i = 0; i < config.maxIterations; i++) {
        // Check if optimization was stopped
        if (!this.isRunning) {
          this.emit("planner:complete", {
            type: "planner:complete",
            success: false,
            message: "Optimization stopped by user",
            bestResult: this.memory.getBest("throughput"),
          } as PlannerEvent);
          return;
        }

        this.emit("planner:iteration_start", {
          type: "planner:iteration_start",
          iteration: i + 1,
        } as PlannerEvent);

        // === OBSERVE ===
        this.emitPhase("observing", "Getting previous simulation metrics...");
        // Use the most recent metrics (from last iteration or baseline)
        const recentExperiments = this.memory.getRecent(1);
        const currentMetrics =
          recentExperiments.length > 0
            ? recentExperiments[0].metrics
            : baselineMetrics;
        const metrics = currentMetrics;
        this.emit("planner:metrics", {
          type: "planner:metrics",
          metrics,
        } as PlannerEvent);

        // === REASON ===
        this.emitPhase(
          "reasoning",
          "LLM analyzing bottleneck and proposing change..."
        );
        const proposal = await this.proposeChange(
          metrics,
          objectives,
          this.memory
        );

        // Check if stopped during LLM call
        if (!this.isRunning) {
          this.emit("planner:complete", {
            type: "planner:complete",
            success: false,
            message: "Optimization stopped by user",
            bestResult: this.memory.getBest("throughput"),
          } as PlannerEvent);
          return;
        }

        this.emit("planner:proposal", {
          type: "planner:proposal",
          proposal,
        } as PlannerEvent);

        // === VALIDATE ===
        this.emitPhase("validating", "Checking safety constraints...");
        const validation = this.validateProposal(
          proposal,
          this.factory.getParams()
        );
        this.emit("planner:validation", {
          type: "planner:validation",
          validation,
        } as PlannerEvent);

        if (!validation.isValid) {
          // Use corrected params if available, otherwise skip
          if (validation.corrections) {
            proposal.proposedChange = validation.corrections;
          } else {
            this.emitPhase(
              "error",
              "Proposal failed validation, skipping iteration"
            );
            continue;
          }
        }

        // === IMPLEMENT ===
        this.emitPhase("implementing", "Applying parameter changes...");
        this.factory.updateParams(proposal.proposedChange);
        this.emit("planner:params_updated", {
          type: "planner:params_updated",
          params: proposal.proposedChange,
        } as PlannerEvent);

        // === SIMULATE ===
        this.emitPhase("simulating", "Running simulation...");
        const simStartTime = Date.now();
        const simResult = await this.runSimulation();
        const simDuration = Date.now() - simStartTime;

        // Check if stopped during simulation
        if (!this.isRunning) {
          this.emit("planner:complete", {
            type: "planner:complete",
            success: false,
            message: "Optimization stopped by user",
            bestResult: this.memory.getBest("throughput"),
          } as PlannerEvent);
          return;
        }

        const newMetrics = await this.analyzeMetrics(simResult);
        this.emit("planner:simulation_complete", {
          type: "planner:simulation_complete",
          metrics: newMetrics,
          duration: simDuration,
        } as PlannerEvent);

        // === EVALUATE ===
        this.emitPhase("evaluating", "Checking goal progress...");
        const progress = this.evaluateGoalProgress(newMetrics, objectives);
        this.emit("planner:goal_progress", {
          type: "planner:goal_progress",
          progress,
        } as PlannerEvent);

        // Store in memory
        const experiment: ExperimentResult = {
          iteration: i + 1,
          timestamp: Date.now(),
          params: this.factory.getParams(),
          proposal,
          metrics: newMetrics,
          goalProgress: progress,
          simulationDuration: simDuration,
        };
        this.memory.store(experiment);

        // Check if improved over best so far (or if this is first iteration)
        // Use the primary goal's metric, defaulting to throughput if not available
        const primaryMetric = objectives.goals[0].metric;
        const comparisonMetric: "throughput" | "cycleTime" | "wip" =
          primaryMetric === "utilization" ? "throughput" : primaryMetric;
        const bestSoFar = this.memory.getBest(comparisonMetric);
        const improved =
          i === 0 ||
          (bestSoFar ? this.isImprovement(newMetrics, bestSoFar.metrics, objectives) : true);

        // Check if goal was achieved
        const goalAchieved = progress.overall >= 1.0;

        this.emit("planner:iteration_complete", {
          type: "planner:iteration_complete",
          iteration: i + 1,
          improved,
          goalAchieved,
        } as PlannerEvent);

        // === DECIDE ===
        if (config.stopOnGoalAchieved && progress.overall >= 1.0) {
          this.emit("planner:complete", {
            type: "planner:complete",
            success: true,
            message: `Goal achieved in ${i + 1} iteration(s)!`,
            bestResult: experiment,
          } as PlannerEvent);
          this.isRunning = false;
          return;
        }

        // Check for stagnation (no improvement in last 3 iterations)
        if (i >= 3 && this.isStagnant(3)) {
          this.emit("planner:complete", {
            type: "planner:complete",
            success: false,
            message: `Stopping - no improvement in last 3 iterations`,
            bestResult: this.memory.getBest("throughput"),
          } as PlannerEvent);
          this.isRunning = false;
          return;
        }
      }

      // Max iterations reached
      this.emit("planner:complete", {
        type: "planner:complete",
        success: false,
        message: `Max iterations (${config.maxIterations}) reached`,
        bestResult: this.memory.getBest("throughput"),
      } as PlannerEvent);
    } catch (error) {
      this.emit("planner:error", {
        type: "planner:error",
        error: error instanceof Error ? error.message : String(error),
      } as PlannerEvent);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Helper to emit phase updates
   */
  private emitPhase(phase: string, message: string): void {
    this.emit("planner:phase", {
      type: "planner:phase",
      phase,
      message,
    } as PlannerEvent);
  }

  /**
   * Parse user goal into structured objectives using LLM
   */
  private async parseGoal(userGoal: string): Promise<ParsedObjectives> {
    try {
      const result = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: z.object({
          goals: z.array(
            z.object({
              type: z
                .enum(["maximize", "minimize", "target"])
                .describe(
                  "maximize = increase metric, minimize = reduce metric, target = reach specific value"
                ),
              metric: z
                .enum(["throughput", "cycleTime", "wip", "utilization"])
                .describe(
                  "throughput = items/hour, cycleTime = minutes per item, wip = work-in-progress count, utilization = resource usage %"
                ),
              target: z
                .number()
                .nullable()
                .optional()
                .describe(
                  "Target value if type is 'target' or 'maximize'/'minimize' with specific goal. Set to null for open-ended goals."
                ),
              description: z
                .string()
                .optional()
                .describe("Human-readable description of this goal"),
            })
          ),
          constraints: z
            .object({
              maxWip: z.number().optional().describe("Maximum acceptable WIP"),
              minUtilization: z
                .number()
                .optional()
                .describe("Minimum resource utilization %"),
              maxCycleTime: z
                .number()
                .optional()
                .describe("Maximum cycle time in minutes"),
            })
            .optional(),
        }),
        prompt: `You are parsing a factory optimization goal.

The factory produces items through 3 stages: Cutting → Cell Processing → Packaging.

Available metrics:
- throughput: items produced per hour
- cycleTime: average minutes from start to finish per item
- wip: work-in-progress (items currently in system)
- utilization: how busy resources are (0-100%)

User's goal: "${userGoal}"

Parse this into structured objectives. Examples:
- "maximize throughput to 28 items/hour" → type: maximize, metric: throughput, target: 28
- "reduce cycle time below 10 minutes" → type: minimize, metric: cycleTime, target: 10
- "minimize WIP" → type: minimize, metric: wip, target: undefined (open-ended: improve as much as possible)
- "minimize cycle time" → type: minimize, metric: cycleTime, target: undefined (open-ended: improve as much as possible)
- "improve throughput" → type: maximize, metric: throughput, target: undefined (open-ended: improve as much as possible)

IMPORTANT: For open-ended goals like "minimize X" or "maximize Y" without a specific number, set target to undefined.
The optimizer will keep trying to improve the metric throughout all available iterations.

If the goal mentions constraints (e.g., "without increasing WIP above 15"), include them in constraints field.`,
      });

      // Add default descriptions if not provided
      const parsed = result.object;
      parsed.goals = parsed.goals.map((goal) => ({
        ...goal,
        description: goal.description || `${goal.type} ${goal.metric}${goal.target ? ` to ${goal.target}` : ''}`,
      }));

      return parsed;
    } catch (error) {
      console.error("[Planner] LLM goal parsing failed:", error);
      // Fallback to simple goal
      return {
        goals: [
          {
            type: "maximize",
            metric: "throughput",
            description:
              "Maximize throughput (fallback goal due to parsing error)",
          },
        ],
      };
    }
  }

  /**
   * Analyze factory state and compute metrics
   */
  private async analyzeMetrics(state: SimState): Promise<MetricsAnalysis> {
    const params = this.factory.getParams();
    const throughput = state.metrics.completed / params.simHours;

    // Find bottleneck (highest utilization)
    let bottleneck = null;
    let maxUtil = 0;
    const resources = state.resources;

    // Check only actual resources (not buffers)
    const resourceNames = ["cutter", "robot", "heater", "packer"] as const;
    for (const name of resourceNames) {
      const resource = resources[name];
      const util = resource.utilization;
      if (util > maxUtil) {
        maxUtil = util;
        bottleneck = {
          resource: name,
          utilization: util,
          queueLength: resource.queueLength,
        };
      }
    }

    return {
      throughput,
      avgCycleTime: state.metrics.avgCycleTime,
      avgWip: state.metrics.wip,
      bottleneck,
      bufferStatus: {
        buf12: {
          utilization: resources.buf12.utilization,
          items: resources.buf12.items,
        },
        buf23: {
          utilization: resources.buf23.utilization,
          items: resources.buf23.items,
        },
      },
    };
  }

  /**
   * Propose parameter change using LLM with context injection
   */
  private async proposeChange(
    metrics: MetricsAnalysis,
    objectives: ParsedObjectives,
    memory: ExperimentMemory
  ): Promise<ParameterProposal> {
    try {
      const currentParams = this.factory.getParams();

      // Fetch relevant manual sections
      const manualResult = await readFactoryManual("bottleneck optimization");
      const manualContext = manualResult.success
        ? manualResult.data
        : { content: "Manual not available" };

      // Format previous attempts
      const recentExperiments = memory.getRecent(3);
      const previousAttempts = recentExperiments
        .map(
          (exp) =>
            `Attempt ${exp.iteration}: Changed ${JSON.stringify(
              exp.proposal.proposedChange
            )} → Throughput: ${exp.metrics.throughput.toFixed(1)}, Outcome: ${
              exp.proposal.expectedOutcome
            }`
        )
        .join("\n");

      // Build comprehensive prompt
      const prompt = `You are an expert factory optimization consultant analyzing a discrete event simulation.

FACTORY STRUCTURE:
- Stage 1: Cutting (uses Cutter resource)
- Stage 2: Cell Processing (uses Robot + Heater resources in parallel)
- Stage 3: Packaging (uses Packer resource)
- Buffers: buf12 (between cutting and cell), buf23 (between cell and packaging)

CURRENT STATE:
- Throughput: ${metrics.throughput.toFixed(1)} items/hour
- Cycle Time: ${metrics.avgCycleTime.toFixed(1)} minutes
- WIP: ${metrics.avgWip.toFixed(1)} items
${
  metrics.bottleneck
    ? `- Bottleneck: ${metrics.bottleneck.resource} at ${(
        metrics.bottleneck.utilization * 100
      ).toFixed(1)}% utilization, queue: ${metrics.bottleneck.queueLength}`
    : "- No clear bottleneck"
}
- Buffer buf12: ${(metrics.bufferStatus.buf12.utilization * 100).toFixed(
        0
      )}% full (${metrics.bufferStatus.buf12.items} items)
- Buffer buf23: ${(metrics.bufferStatus.buf23.utilization * 100).toFixed(
        0
      )}% full (${metrics.bufferStatus.buf23.items} items)

CURRENT PARAMETERS:
${JSON.stringify(currentParams, null, 2)}

OPTIMIZATION GOAL:
${objectives.goals
  .map((g) => `- ${g.description}${g.target ? ` (target: ${g.target})` : ""}`)
  .join("\n")}

PREVIOUS ATTEMPTS:
${previousAttempts || "None yet - this is the first iteration"}

MANUAL EXCERPT (Optimization Strategies):
${
  typeof manualContext === "string"
    ? manualContext.substring(0, 2000)
    : JSON.stringify(manualContext).substring(0, 2000)
}

TASK:
Propose one or more parameter changes to move closer to the goal. You can make multiple complementary changes in a single iteration.

PARAMETER OPTIONS:
- Capacities: cutterCapacity, robotCapacity, heaterCapacity, packerCapacity (range: 1-3)
- Processing times: cutTime, cellTime, packTime (in minutes, must be positive)
- Buffer sizes: buf12Cap, buf23Cap (range: 2-20)
- Arrival rate: arrivalMean (mean time between arrivals in minutes, higher = slower arrival)

GUIDELINES:
1. If bottleneck utilization >85%, consider increasing its capacity or reducing its processing time
2. If buffers are full/empty, consider resizing them
3. If WIP is too high, increase arrivalMean (slow down arrivals) or fix downstream bottleneck
4. Don't repeat failed previous attempts
5. You can make multiple complementary changes (e.g., increase bottleneck capacity AND adjust buffers)
6. However, avoid making too many changes at once - aim for 1-3 related changes for clarity

Provide your analysis and proposal.`;

      const result = await generateObject({
        model: openai("gpt-4o"),
        schema: z.object({
          analysis: z
            .string()
            .describe(
              "Brief analysis of the current bottleneck and system state"
            ),
          reasoning: z
            .string()
            .describe(
              "Detailed explanation of WHY these changes will help achieve the goal"
            ),
          proposedChange: z
            .record(z.string(), z.number())
            .describe(
              "One or more parameter changes as key-value pairs, e.g., {robotCapacity: 2, buf12Cap: 8} or {cellTime: 2.0}. Can include 1-3 complementary changes."
            ),
          expectedOutcome: z
            .string()
            .describe(
              "Predicted impact on throughput, cycle time, or other metrics"
            ),
          confidence: z
            .enum(["low", "medium", "high"])
            .describe("Confidence level in this proposal"),
        }),
        prompt,
      });

      console.log("[Planner] LLM proposal:", result.object);
      return result.object;
    } catch (error) {
      console.error("[Planner] LLM proposal failed:", error);
      // Fallback to simple rule-based proposal
      return this.fallbackProposal(metrics);
    }
  }

  /**
   * Fallback proposal if LLM fails
   */
  private fallbackProposal(metrics: MetricsAnalysis): ParameterProposal {
    const currentParams = this.factory.getParams();

    if (!metrics.bottleneck) {
      return {
        analysis: "No clear bottleneck detected",
        reasoning: "System appears balanced, making conservative adjustment",
        proposedChange: { arrivalMean: currentParams.arrivalMean * 1.1 },
        expectedOutcome: "Slightly reduced load for stability",
        confidence: "low",
      };
    }

    const { resource, utilization } = metrics.bottleneck;
    const capacityParam = `${resource}Capacity` as keyof SimParams;
    const currentCapacity = currentParams[capacityParam] as number;

    if (utilization > 0.85 && currentCapacity < 3) {
      return {
        analysis: `Bottleneck: ${resource} at ${(utilization * 100).toFixed(
          1
        )}% utilization`,
        reasoning: `Increasing ${resource} capacity to reduce bottleneck`,
        proposedChange: { [capacityParam]: currentCapacity + 1 },
        expectedOutcome: "Reduced bottleneck utilization, increased throughput",
        confidence: "medium",
      };
    }

    return {
      analysis: `Bottleneck: ${resource} but capacity maxed`,
      reasoning: "Making conservative adjustment to arrival rate",
      proposedChange: { arrivalMean: currentParams.arrivalMean * 1.05 },
      expectedOutcome: "Slightly reduced system load",
      confidence: "low",
    };
  }

  /**
   * Validate proposal against safety constraints
   */
  private validateProposal(
    proposal: ParameterProposal,
    currentParams: SimParams
  ): ValidationResult {
    const warnings: string[] = [];
    const corrections: Partial<SimParams> = {};
    let isValid = true;

    for (const [key, value] of Object.entries(proposal.proposedChange)) {
      // Check capacity bounds (1-3)
      if (key.includes("Capacity")) {
        if (typeof value === "number" && (value < 1 || value > 10)) {
          warnings.push(`${key} out of bounds (1-10): ${value}`);
          corrections[key as keyof SimParams] = Math.max(
            1,
            Math.min(10, value)
          ) as any;
          isValid = false;
        }
      }

      // Check buffer capacity bounds (2-20)
      if (key.includes("Cap") && key.startsWith("buf")) {
        if (typeof value === "number" && (value < 2 || value > 30)) {
          warnings.push(`${key} out of bounds (2-20): ${value}`);
          corrections[key as keyof SimParams] = Math.max(
            2,
            Math.min(30, value)
          ) as any;
          isValid = false;
        }
      }

      // Check processing times are positive
      if (key.includes("Time") && !key.includes("Var")) {
        if (typeof value === "number" && value <= 0) {
          warnings.push(`${key} must be positive: ${value}`);
          isValid = false;
        }
      }

      // Check no extreme changes (>2x)
      const currentValue = currentParams[key as keyof SimParams];
      if (typeof value === "number" && typeof currentValue === "number") {
        const ratio = Math.abs(value - currentValue) / currentValue;
        if (ratio > 1.0) {
          warnings.push(
            `${key} change too extreme: ${currentValue} -> ${value}`
          );
          corrections[key as keyof SimParams] = (currentValue * 1.5) as any;
          isValid = false;
        }
      }
    }

    return {
      isValid: isValid && warnings.length === 0,
      warnings,
      corrections:
        Object.keys(corrections).length > 0 ? corrections : undefined,
    };
  }

  /**
   * Run simulation and wait for completion
   */
  private async runSimulation(): Promise<SimState> {
    return new Promise<SimState>((resolve) => {
      const params = this.factory.getParams();
      const totalTime = params.simHours * 60; // Convert to minutes

      // Emit start
      this.emit("planner:simulation_start", {
        type: "planner:simulation_start",
      } as PlannerEvent);

      // Listen for state updates and emit progress
      const stateHandler = (state: SimState) => {
        const progress = (state.time / totalTime) * 100;
        this.emit("planner:simulation_progress", {
          type: "planner:simulation_progress",
          state,
          progress,
        } as PlannerEvent);
      };

      // Listen for completion
      const completeHandler = (finalState: SimState) => {
        this.factory.off("state", stateHandler);
        this.factory.off("complete", completeHandler);
        resolve(finalState);
      };

      this.factory.on("state", stateHandler);
      this.factory.on("complete", completeHandler);

      // Start simulation
      this.factory.reset();
      this.factory.start();
    });
  }

  /**
   * Evaluate progress toward goals
   */
  private evaluateGoalProgress(
    metrics: MetricsAnalysis,
    objectives: ParsedObjectives
  ): GoalProgress {
    const goalProgress: GoalProgress["goals"] = {};
    let totalProgress = 0;

    for (const goal of objectives.goals) {
      const current = this.getMetricValue(metrics, goal.metric);
      const hasExplicitTarget = goal.target !== undefined && goal.target !== null;
      const target =
        goal.target ?? this.getDefaultTarget(goal.metric, goal.type);

      let progress = 0;
      let achieved = false;

      if (goal.type === "maximize") {
        progress = Math.min(1, current / target);
        // Open-ended goals (no explicit target) are never "achieved"
        achieved = hasExplicitTarget && current >= target;
      } else if (goal.type === "minimize") {
        progress = Math.min(1, target / current);
        // Open-ended goals (no explicit target) are never "achieved"
        achieved = hasExplicitTarget && current <= target;
      } else {
        // target type - always has explicit target
        const diff = Math.abs(current - target);
        progress = Math.max(0, 1 - diff / target);
        achieved = diff / target < 0.05; // Within 5%
      }

      goalProgress[`${goal.metric}_${goal.type}`] = {
        achieved,
        current,
        target,
        progress,
      };

      totalProgress += progress;
    }

    return {
      overall: totalProgress / objectives.goals.length,
      goals: goalProgress,
    };
  }

  private getMetricValue(metrics: MetricsAnalysis, metric: string): number {
    switch (metric) {
      case "throughput":
        return metrics.throughput;
      case "cycleTime":
        return metrics.avgCycleTime;
      case "wip":
        return metrics.avgWip;
      default:
        return 0;
    }
  }

  private getDefaultTarget(metric: string, type: string): number {
    if (type === "maximize" && metric === "throughput") return 30;
    if (type === "minimize" && metric === "cycleTime") return 8;
    if (type === "minimize" && metric === "wip") return 5;
    return 1;
  }

  /**
   * Check if new metrics represent an improvement
   */
  private isImprovement(
    newMetrics: MetricsAnalysis,
    oldMetrics: MetricsAnalysis,
    objectives: ParsedObjectives
  ): boolean {
    for (const goal of objectives.goals) {
      const newVal = this.getMetricValue(newMetrics, goal.metric);
      const oldVal = this.getMetricValue(oldMetrics, goal.metric);

      if (goal.type === "maximize" && newVal > oldVal) return true;
      if (goal.type === "minimize" && newVal < oldVal) return true;

      // For target goals, check if we're getting closer to the target
      if (goal.type === "target" && goal.target !== null && goal.target !== undefined) {
        const oldDistance = Math.abs(oldVal - goal.target);
        const newDistance = Math.abs(newVal - goal.target);
        if (newDistance < oldDistance) return true;
      }
    }
    return false;
  }

  /**
   * Check if optimization has stagnated
   */
  private isStagnant(windowSize: number): boolean {
    const recent = this.memory.getRecent(windowSize + 1);
    if (recent.length < windowSize + 1) return false;

    const baseline = recent[0].metrics.throughput;
    for (let i = 1; i < recent.length; i++) {
      const improvement = (recent[i].metrics.throughput - baseline) / baseline;
      if (Math.abs(improvement) > 0.02) return false; // >2% change
    }
    return true;
  }

  /**
   * Stop the planner
   */
  stop(): void {
    this.isRunning = false;
    this.factory.stop();
  }

  /**
   * Get current memory state
   */
  getMemory(): ExperimentResult[] {
    return this.memory.getAll();
  }
}
