// plannerAgent.ts - Fully LLM-centric planner agent

import { EventEmitter } from "events";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { FactorySimulation, SimState, SimParams } from "./FactorySimulation.js";
import {
  PlannerEvent,
  PlannerConfig,
  MetricsAnalysis,
  ParameterProposal,
  ValidationResult,
  ExperimentResult,
} from "./plannerTypes.js";
// Removed: readFactoryManual - not providing useful context in prompts

/**
 * Simple experiment memory for storing past results
 */
class ExperimentMemory {
  private experiments: ExperimentResult[] = [];

  store(experiment: ExperimentResult): void {
    this.experiments.push(experiment);
  }

  getAll(): ExperimentResult[] {
    return [...this.experiments];
  }

  getRecent(count: number): ExperimentResult[] {
    return this.experiments.slice(-count);
  }

  size(): number {
    return this.experiments.length;
  }

  clear(): void {
    this.experiments = [];
  }
}

/**
 * LLM Decision result - combines analysis, evaluation, and next action
 */
interface LLMDecision {
  goalInterpretation: string; // LLM's interpretation of what the user wants
  currentStateAnalysis: string; // What's happening in the factory right now
  progressEvaluation: string; // Qualitative assessment of progress toward goals
  progressSummary: string; // Short summary for UI
  decision: "continue" | "stop_success" | "stop_stagnant" | "stop_no_options";
  decisionReasoning: string; // Why this decision was made
  proposedChanges?: Record<string, number>; // If continuing, parameter changes
  changeReasoning?: string | null; // If continuing, why these changes
  expectedOutcome?: string | null; // If continuing, predicted impact
  confidence?: string | null; // If continuing, confidence level (should be "low", "medium", or "high")
}

/**
 * Main Planner Agent class - Fully LLM-centric version
 * LLM handles all interpretation, evaluation, and decision making
 */
export class PlannerAgent extends EventEmitter {
  private factory: FactorySimulation;
  private memory: ExperimentMemory;
  private isRunning = false;
  private userGoal: string = "";

  constructor(factory: FactorySimulation) {
    super();
    this.factory = factory;
    this.memory = new ExperimentMemory();
  }

  /**
   * Main optimization loop - LLM interprets goals and evaluates progress
   */
  async optimize(userGoal: string, config: PlannerConfig): Promise<void> {
    if (this.isRunning) {
      throw new Error("Planner is already running");
    }

    this.isRunning = true;
    this.memory.clear();
    this.userGoal = userGoal;

    try {
      // Emit start event
      this.emit("planner:start", {
        type: "planner:start",
        goal: userGoal,
        maxIterations: config.maxIterations,
      } as PlannerEvent);

      // Run baseline simulation
      this.emitPhase("baseline", "Running baseline simulation...");
      const baselineResult = await this.runSimulation();
      const baselineMetrics = this.extractMetrics(baselineResult);
      this.emit("planner:metrics_after", {
        type: "planner:metrics_after",
        metrics: baselineMetrics,
        duration: 0,
        label: "Baseline Results (initial factory state)",
      } as PlannerEvent);

      // Main iteration loop
      // Start with baseline state for first LLM analysis
      let currentState = baselineResult;
      let currentIteration = 0;

      for (let i = 0; i < config.maxIterations; i++) {
        if (!this.isRunning) {
          this.emit("planner:complete", {
            type: "planner:complete",
            success: false,
            message: "Optimization stopped by user",
            finalMetrics: this.extractMetrics(currentState),
          } as PlannerEvent);
          return;
        }

        // === FIRST: Check if we should continue or stop (before starting new iteration) ===
        // For i > 0, we need to analyze the previous iteration's results first
        if (i > 0) {
          // Extract and emit current metrics for UI (what we're analyzing)
          const currentMetrics = this.extractMetrics(currentState);
          const metricsLabel = `Evaluating results after Iteration ${i}`;
          this.emit("planner:metrics_before", {
            type: "planner:metrics_before",
            metrics: currentMetrics,
            label: metricsLabel,
          } as PlannerEvent);

          // === LLM REASONING: Analyze, Evaluate, Decide ===
          this.emitPhase(
            "reasoning",
            "LLM evaluating results and deciding next action..."
          );
          const decision = await this.llmAnalyzeAndDecide(
            currentState,
            this.memory,
            currentIteration
          );

          if (!this.isRunning) {
            this.emit("planner:complete", {
              type: "planner:complete",
              success: false,
              message: "Optimization stopped by user",
              finalMetrics: this.extractMetrics(currentState),
            } as PlannerEvent);
            return;
          }

          // Emit LLM's goal interpretation and progress evaluation
          this.emit("planner:progress_evaluation", {
            type: "planner:progress_evaluation",
            goalInterpretation: decision.goalInterpretation,
            progressEvaluation: decision.progressEvaluation,
            progressSummary: decision.progressSummary,
          } as PlannerEvent);

          // Check if LLM decided to stop
          if (decision.decision !== "continue") {
            const success = decision.decision === "stop_success";
            this.emit("planner:complete", {
              type: "planner:complete",
              success,
              message: `${decision.decisionReasoning}`,
              finalMetrics: this.extractMetrics(currentState),
            } as PlannerEvent);
            this.isRunning = false;
            return;
          }

          // LLM wants to continue - validate and apply proposal below
          if (!decision.proposedChanges) {
            this.emit("planner:complete", {
              type: "planner:complete",
              success: false,
              message: "LLM decided to continue but provided no changes",
              finalMetrics: this.extractMetrics(currentState),
            } as PlannerEvent);
            this.isRunning = false;
            return;
          }

          // Now start the new iteration
          this.emit("planner:iteration_start", {
            type: "planner:iteration_start",
            iteration: i + 1,
          } as PlannerEvent);

          // Convert decision into ParameterProposal format for events
          const proposal: ParameterProposal = {
            analysis: decision.currentStateAnalysis,
            reasoning: decision.changeReasoning || "No reasoning provided",
            proposedChange: decision.proposedChanges,
            expectedOutcome: decision.expectedOutcome || "No outcome specified",
            confidence: decision.confidence || "medium",
          };

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

          // === APPLY CHANGES ===
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

          if (!this.isRunning) {
            this.emit("planner:complete", {
              type: "planner:complete",
              success: false,
              message: "Optimization stopped by user",
              finalMetrics: this.extractMetrics(simResult),
            } as PlannerEvent);
            return;
          }

          const newMetrics = this.extractMetrics(simResult);
          const afterLabel = `Iteration ${i + 1} Results (after applying changes)`;
          this.emit("planner:metrics_after", {
            type: "planner:metrics_after",
            metrics: newMetrics,
            duration: simDuration,
            label: afterLabel,
          } as PlannerEvent);

          // Store experiment for history
          const experiment: ExperimentResult = {
            iteration: i + 1,
            timestamp: Date.now(),
            params: this.factory.getParams(),
            proposal,
            state: simResult,
            progressSummary: decision.progressSummary,
            simulationDuration: simDuration,
          };
          this.memory.store(experiment);

          this.emit("planner:iteration_complete", {
            type: "planner:iteration_complete",
            iteration: i + 1,
            progressSummary: decision.progressSummary,
          } as PlannerEvent);

          // Update state for next iteration's evaluation
          currentState = simResult;
          currentIteration = i + 1;
        } else {
          // === FIRST ITERATION (i === 0): Analyze baseline and start ===
          this.emit("planner:iteration_start", {
            type: "planner:iteration_start",
            iteration: 1,
          } as PlannerEvent);

          // Extract and emit baseline metrics
          const currentMetrics = this.extractMetrics(currentState);
          this.emit("planner:metrics_before", {
            type: "planner:metrics_before",
            metrics: currentMetrics,
            label: "Baseline Metrics (before any changes)",
          } as PlannerEvent);

          // === LLM REASONING: Analyze baseline and propose first changes ===
          this.emitPhase(
            "reasoning",
            "LLM analyzing baseline and proposing improvements..."
          );
          const decision = await this.llmAnalyzeAndDecide(
            currentState,
            this.memory,
            0
          );

          if (!this.isRunning) {
            this.emit("planner:complete", {
              type: "planner:complete",
              success: false,
              message: "Optimization stopped by user",
              finalMetrics: this.extractMetrics(currentState),
            } as PlannerEvent);
            return;
          }

          // Emit LLM's goal interpretation and progress evaluation
          this.emit("planner:progress_evaluation", {
            type: "planner:progress_evaluation",
            goalInterpretation: decision.goalInterpretation,
            progressEvaluation: decision.progressEvaluation,
            progressSummary: decision.progressSummary,
          } as PlannerEvent);

          // Check if baseline already meets goal
          if (decision.decision !== "continue") {
            const success = decision.decision === "stop_success";
            this.emit("planner:complete", {
              type: "planner:complete",
              success,
              message: `${decision.decisionReasoning}`,
              finalMetrics: this.extractMetrics(currentState),
            } as PlannerEvent);
            this.isRunning = false;
            return;
          }

          // LLM wants to continue - validate and apply proposal
          if (!decision.proposedChanges) {
            this.emit("planner:complete", {
              type: "planner:complete",
              success: false,
              message: "LLM decided to continue but provided no changes",
              finalMetrics: this.extractMetrics(currentState),
            } as PlannerEvent);
            this.isRunning = false;
            return;
          }

          // Convert decision into ParameterProposal format for events
          const proposal: ParameterProposal = {
            analysis: decision.currentStateAnalysis,
            reasoning: decision.changeReasoning || "No reasoning provided",
            proposedChange: decision.proposedChanges,
            expectedOutcome: decision.expectedOutcome || "No outcome specified",
            confidence: decision.confidence || "medium",
          };

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

          // === APPLY CHANGES ===
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

          if (!this.isRunning) {
            this.emit("planner:complete", {
              type: "planner:complete",
              success: false,
              message: "Optimization stopped by user",
              finalMetrics: this.extractMetrics(simResult),
            } as PlannerEvent);
            return;
          }

          const newMetrics = this.extractMetrics(simResult);
          const afterLabel = `Iteration 1 Results (after applying changes)`;
          this.emit("planner:metrics_after", {
            type: "planner:metrics_after",
            metrics: newMetrics,
            duration: simDuration,
            label: afterLabel,
          } as PlannerEvent);

          // Store experiment for history
          const experiment: ExperimentResult = {
            iteration: 1,
            timestamp: Date.now(),
            params: this.factory.getParams(),
            proposal,
            state: simResult,
            progressSummary: decision.progressSummary,
            simulationDuration: simDuration,
          };
          this.memory.store(experiment);

          this.emit("planner:iteration_complete", {
            type: "planner:iteration_complete",
            iteration: 1,
            progressSummary: decision.progressSummary,
          } as PlannerEvent);

          // Update state for next iteration's evaluation
          currentState = simResult;
          currentIteration = 1;
        }
      }

      // Max iterations reached
      const finalState = this.memory.getRecent(1)[0]?.state || baselineResult;
      this.emit("planner:complete", {
        type: "planner:complete",
        success: false,
        message: `Max iterations (${config.maxIterations}) reached`,
        finalMetrics: this.extractMetrics(finalState),
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
   * LLM analyzes current state, evaluates progress, and decides next action
   * This is the core of the agent - LLM does ALL reasoning (including bottleneck analysis)
   */
  private async llmAnalyzeAndDecide(
    state: SimState,
    memory: ExperimentMemory,
    iteration: number
  ): Promise<LLMDecision> {
    try {
      const currentParams = this.factory.getParams();

      // Calculate throughput for current state
      const throughput = state.metrics.completed / currentParams.simHours;

      // Format experiment history - show ALL metrics, let LLM decide what matters
      const allExperiments = memory.getAll();
      let experimentHistory: string;

      if (allExperiments.length === 0) {
        experimentHistory = iteration === 0
          ? "No previous experiments - analyzing baseline state"
          : "No previous experiments stored";
      } else {
        // Show complete information for each experiment
        experimentHistory = allExperiments
          .map((exp) => {
            const expThroughput = exp.state.metrics.completed / exp.params.simHours;
            const expCycleTime = exp.state.metrics.avgCycleTime;
            const expWip = exp.state.metrics.wip;
            const expCompleted = exp.state.metrics.completed;

            return `Iteration ${exp.iteration}:
  Changes Applied: ${JSON.stringify(exp.proposal.proposedChange)}
  Resulting Metrics:
    - Completed: ${expCompleted} items in ${exp.params.simHours} hours
    - Throughput: ${expThroughput.toFixed(2)} items/hour
    - Cycle Time: ${expCycleTime.toFixed(2)} minutes
    - WIP: ${expWip.toFixed(2)} items
  LLM's Progress Assessment: "${exp.progressSummary}"`;
          })
          .join("\n\n");
      }

      // Build comprehensive prompt with RAW state data
      const stateLabel = iteration === 0
        ? "CURRENT STATE (Baseline - before any changes)"
        : `CURRENT STATE (After Iteration ${iteration} changes)`;

      const prompt = `You are an expert factory optimization agent. Analyze the current state, interpret the user's goal, evaluate progress, and decide the next action.

FACTORY STRUCTURE:
- Stage 1: Cutting (Cutter resource)
- Stage 2: Cell Processing (Robot + Heater in parallel)
- Stage 3: Packaging (Packer resource)
- Buffers: buf12 (between stages 1-2), buf23 (between stages 2-3)

${stateLabel}
Simulation ran for ${currentParams.simHours} hours

Performance Metrics:
- Completed items: ${state.metrics.completed}
- Throughput: ${throughput.toFixed(1)} items/hour
- Average cycle time: ${state.metrics.avgCycleTime.toFixed(1)} minutes
- WIP (work in progress): ${state.metrics.wip.toFixed(1)} items

Resource Utilization (YOU decide what's the bottleneck):
- Cutter: ${(state.resources.cutter.utilization * 100).toFixed(1)}% utilized, ${state.resources.cutter.inUse}/${state.resources.cutter.capacity} in use, queue: ${state.resources.cutter.queueLength}
- Robot: ${(state.resources.robot.utilization * 100).toFixed(1)}% utilized, ${state.resources.robot.inUse}/${state.resources.robot.capacity} in use, queue: ${state.resources.robot.queueLength}
- Heater: ${(state.resources.heater.utilization * 100).toFixed(1)}% utilized, ${state.resources.heater.inUse}/${state.resources.heater.capacity} in use, queue: ${state.resources.heater.queueLength}
- Packer: ${(state.resources.packer.utilization * 100).toFixed(1)}% utilized, ${state.resources.packer.inUse}/${state.resources.packer.capacity} in use, queue: ${state.resources.packer.queueLength}

Buffer Status:
- buf12: ${state.resources.buf12.items}/${state.resources.buf12.capacity} items (${(state.resources.buf12.utilization * 100).toFixed(0)}% full)
- buf23: ${state.resources.buf23.items}/${state.resources.buf23.capacity} items (${(state.resources.buf23.utilization * 100).toFixed(0)}% full)

CURRENT PARAMETERS:
${JSON.stringify(currentParams, null, 2)}

USER'S GOAL (in their own words):
"${this.userGoal}"

EXPERIMENT HISTORY:
${experimentHistory}

YOUR TASK:
1. INTERPRET the user's goal - what do they actually want? Be flexible with vague or conflicting goals.
2. ANALYZE the current factory state - YOU identify bottlenecks, not me. Look at ALL resources.
3. EVALUATE progress toward the interpreted goal - explain what's working, what's not, how close we are
4. SUMMARIZE progress in 3-5 words for the UI
5. DECIDE what to do next:
   - "continue" if there's room for improvement and you have ideas
   - "stop_success" if the goal is achieved or close enough
   - "stop_stagnant" if no more improvement seems possible
   - "stop_no_options" if you're out of ideas or hitting limits
6. If continuing, PROPOSE 1-3 parameter changes

PARAMETER OPTIONS:
- Capacities: cutterCapacity, robotCapacity, heaterCapacity, packerCapacity (1-10)
- Times: cutTime, cellTime, packTime (positive numbers, minutes)
- Buffers: buf12Cap, buf23Cap (2-30)
- Arrival: arrivalMean (minutes between arrivals)

DECISION GUIDELINES:
- Be flexible interpreting vague goals like "make it better" or "optimize the factory"
- For conflicting goals (e.g., "maximize throughput AND minimize WIP"), make reasonable tradeoffs
- Explain your progress assessment in detail - this helps the user understand what's happening
- Consider: Have we tried similar changes? Are we repeating patterns?
- Look for: High utilization (>85%), full/empty buffers, growing queues, imbalances between stages
- Avoid: Repeating failed experiments, extreme changes (>50% at once)
- Stop early if stuck in a loop or if the goal seems achieved`;

      const result = await generateObject({
        model: openai("gpt-4o"),
        schema: z.object({
          goalInterpretation: z
            .string()
            .describe("Your interpretation of what the user wants to achieve"),
          currentStateAnalysis: z
            .string()
            .describe("What's happening in the factory right now - identify bottlenecks, issues"),
          progressEvaluation: z
            .string()
            .describe(
              "Detailed qualitative assessment of progress toward the goal - explain how close we are, what's working, what's not"
            ),
          progressSummary: z
            .string()
            .describe(
              "Short 3-5 word summary of progress status (e.g., 'Making good progress', 'Goal achieved', 'Stuck at bottleneck')"
            ),
          decision: z
            .enum(["continue", "stop_success", "stop_stagnant", "stop_no_options"])
            .describe("What to do next"),
          decisionReasoning: z
            .string()
            .describe("Why you made this decision - explain your logic"),
          proposedChanges: z
            .record(z.string(), z.number())
            .optional()
            .describe("If continuing: parameter changes as {key: value} pairs. Omit or use empty object {} if stopping."),
          changeReasoning: z
            .string()
            .nullable()
            .optional()
            .describe("If continuing: why these specific changes will help achieve the goal. Use null or empty string if stopping."),
          expectedOutcome: z
            .string()
            .nullable()
            .optional()
            .describe("If continuing: predicted impact of the changes. Use null or empty string if stopping."),
          confidence: z
            .string()
            .nullable()
            .optional()
            .describe("If continuing: confidence level (low/medium/high). Use null or empty string if stopping."),
        }),
        prompt,
      });

      // Clean up the response: convert empty strings and nulls to undefined for optional fields
      const cleanedResult = { ...result.object };
      if (cleanedResult.changeReasoning === "" || cleanedResult.changeReasoning === null) {
        cleanedResult.changeReasoning = undefined;
      }
      if (cleanedResult.expectedOutcome === "" || cleanedResult.expectedOutcome === null) {
        cleanedResult.expectedOutcome = undefined;
      }
      if (cleanedResult.confidence === null) {
        cleanedResult.confidence = undefined;
      }

      return cleanedResult;
    } catch (error) {
      console.error("[Planner] LLM decision failed:", error);
      // Fallback: stop on error
      return {
        goalInterpretation: "Unable to interpret goal",
        currentStateAnalysis: "LLM analysis failed",
        progressEvaluation: "Cannot evaluate progress due to LLM error",
        progressSummary: "Error occurred",
        decision: "stop_no_options",
        decisionReasoning: "LLM call failed, stopping optimization",
      };
    }
  }

  /**
   * Simple safety validation - just check bounds
   */
  private validateProposal(
    proposal: ParameterProposal,
    _currentParams: SimParams
  ): ValidationResult {
    const warnings: string[] = [];
    const corrections: Partial<SimParams> = {};
    let isValid = true;

    for (const [key, value] of Object.entries(proposal.proposedChange)) {
      // Capacity bounds (1-10)
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

      // Buffer bounds (2-30)
      if (key.includes("Cap") && key.startsWith("buf")) {
        if (typeof value === "number" && (value < 2 || value > 30)) {
          warnings.push(`${key} out of bounds (2-30): ${value}`);
          corrections[key as keyof SimParams] = Math.max(
            2,
            Math.min(30, value)
          ) as any;
          isValid = false;
        }
      }

      // Processing times must be positive
      if (key.includes("Time") && !key.includes("Var")) {
        if (typeof value === "number" && value <= 0) {
          warnings.push(`${key} must be positive: ${value}`);
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
   * Extract metrics from simulation state
   */
  private extractMetrics(state: SimState): MetricsAnalysis {
    const params = this.factory.getParams();
    const throughput = state.metrics.completed / params.simHours;
    const resources = state.resources;

    // Find bottleneck (resource with highest utilization)
    const resourceNames = ["cutter", "robot", "heater", "packer"] as const;
    let bottleneck = null;
    let maxUtil = 0;

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
   * Run simulation and wait for completion
   */
  private async runSimulation(): Promise<SimState> {
    return new Promise<SimState>((resolve) => {
      const params = this.factory.getParams();
      const totalTime = params.simHours * 60;

      this.emit("planner:simulation_start", {
        type: "planner:simulation_start",
      } as PlannerEvent);

      const stateHandler = (state: SimState) => {
        const progress = (state.time / totalTime) * 100;
        this.emit("planner:simulation_progress", {
          type: "planner:simulation_progress",
          state,
          progress,
        } as PlannerEvent);
      };

      const completeHandler = (finalState: SimState) => {
        this.factory.off("state", stateHandler);
        this.factory.off("complete", completeHandler);
        resolve(finalState);
      };

      this.factory.on("state", stateHandler);
      this.factory.on("complete", completeHandler);

      this.factory.reset();
      this.factory.start();
    });
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
