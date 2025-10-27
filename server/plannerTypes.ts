// plannerTypes.ts - Type definitions for the planner system

import { SimState, SimParams } from "./FactorySimulation.js";

/**
 * Optimization goal defined by the user
 */
export interface OptimizationGoal {
  type: "maximize" | "minimize" | "target";
  metric: "throughput" | "cycleTime" | "wip" | "utilization";
  target?: number | null; // null for open-ended goals
  description?: string; // Human-readable description of the goal
}

/**
 * Parsed objectives from user goal
 */
export interface ParsedObjectives {
  goals: OptimizationGoal[];
  constraints?: {
    maxWip?: number;
    minUtilization?: number;
    maxCycleTime?: number;
  };
}

/**
 * Analysis of current factory metrics
 */
export interface MetricsAnalysis {
  throughput: number; // items/hour
  avgCycleTime: number; // minutes
  avgWip: number; // items
  bottleneck: {
    resource: string;
    utilization: number;
    queueLength: number;
  } | null;
  bufferStatus: {
    buf12: { utilization: number; items: number };
    buf23: { utilization: number; items: number };
  };
}

/**
 * LLM-generated proposal for parameter change
 */
export interface ParameterProposal {
  reasoning: string;
  analysis: string;
  proposedChange: Partial<SimParams>;
  expectedOutcome: string;
  confidence: "low" | "medium" | "high";
}

/**
 * Validation result for a proposal
 */
export interface ValidationResult {
  isValid: boolean;
  warnings: string[];
  corrections?: Partial<SimParams>;
}

/**
 * Stored experiment result in memory
 */
export interface ExperimentResult {
  iteration: number;
  timestamp: number;
  params: SimParams;
  proposal: ParameterProposal;
  metrics: MetricsAnalysis;
  goalProgress: GoalProgress;
  simulationDuration: number; // ms
}

/**
 * Progress toward each goal
 */
export interface GoalProgress {
  overall: number; // 0-1
  goals: {
    [key: string]: {
      achieved: boolean;
      current: number;
      target: number | null;
      progress: number; // 0-1
    };
  };
}

/**
 * Planner event types for streaming
 */
export type PlannerEvent =
  | { type: "planner:start"; goal: string; maxIterations: number }
  | { type: "planner:goal_parsed"; objectives: ParsedObjectives }
  | { type: "planner:iteration_start"; iteration: number }
  | { type: "planner:phase"; phase: string; message: string }
  | { type: "planner:metrics"; metrics: MetricsAnalysis }
  | { type: "planner:proposal"; proposal: ParameterProposal }
  | { type: "planner:validation"; validation: ValidationResult }
  | { type: "planner:params_updated"; params: Partial<SimParams> }
  | { type: "planner:simulation_start" }
  | { type: "planner:simulation_progress"; state: SimState; progress: number }
  | { type: "planner:simulation_complete"; metrics: MetricsAnalysis; duration: number }
  | { type: "planner:goal_progress"; progress: GoalProgress }
  | { type: "planner:iteration_complete"; iteration: number; improved: boolean; goalAchieved: boolean }
  | { type: "planner:complete"; success: boolean; message: string; bestResult: ExperimentResult | null }
  | { type: "planner:error"; error: string };

/**
 * Planner configuration
 */
export interface PlannerConfig {
  maxIterations: number;
  simulationHours?: number; // Override default simulation duration
  stopOnGoalAchieved?: boolean; // Stop immediately when goal is met
  explorationFactor?: number; // 0-1, how much to explore vs exploit
}
