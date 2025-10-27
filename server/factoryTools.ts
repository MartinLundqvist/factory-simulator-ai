import { FactorySimulation, SimParams } from "./FactorySimulation.js";
import * as fs from "fs/promises";
import * as path from "path";

// MCP Tool definitions for the factory agent

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

// Tool 1: Factory Control
export const factoryControlTool: MCPTool = {
  name: "factory_control",
  description:
    "Control the factory simulation. Available actions: start, stop, reset, getState.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["start", "stop", "reset", "getState"],
        description: "The action to perform on the factory simulation",
      },
    },
    required: ["action"],
  },
};

// Tool 2: Factory Parameters Management
export const factoryParamsTool: MCPTool = {
  name: "factory_params",
  description:
    "Get or update factory simulation parameters. Can read all parameters or update specific ones. Use 'get' to retrieve current parameters, or 'update' with a params object to modify specific parameters.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["get", "update"],
        description: "Get current parameters or update them",
      },
      params: {
        type: "object",
        description:
          "Parameters to update (only used with 'update' action). Provide an object with one or more parameter fields to update.",
        properties: {
          randomSeed: {
            type: "number",
            description: "Random seed for reproducibility",
          },
          simHours: {
            type: "number",
            description: "Simulation duration in hours",
          },
          arrivalMean: {
            type: "number",
            description: "Mean time between arrivals (minutes)",
          },
          cutTime: {
            type: "number",
            description: "Base cutting time (minutes)",
          },
          cellTime: {
            type: "number",
            description: "Base cell processing time (minutes)",
          },
          packTime: {
            type: "number",
            description: "Base packaging time (minutes)",
          },
          cutTimeVarLow: {
            type: "number",
            description: "Lower variance coefficient for cutting time",
          },
          cutTimeVarHigh: {
            type: "number",
            description: "Upper variance coefficient for cutting time",
          },
          cellTimeVarLow: {
            type: "number",
            description: "Lower variance coefficient for cell processing time",
          },
          cellTimeVarHigh: {
            type: "number",
            description: "Upper variance coefficient for cell processing time",
          },
          packTimeVarLow: {
            type: "number",
            description: "Lower variance coefficient for packaging time",
          },
          packTimeVarHigh: {
            type: "number",
            description: "Upper variance coefficient for packaging time",
          },
          cutterCapacity: {
            type: "number",
            description: "Number of cutter resources",
          },
          robotCapacity: {
            type: "number",
            description: "Number of robot resources",
          },
          heaterCapacity: {
            type: "number",
            description: "Number of heater resources",
          },
          packerCapacity: {
            type: "number",
            description: "Number of packer resources",
          },
          buf12Cap: {
            type: "number",
            description: "Buffer capacity between cutting and cell processing",
          },
          buf23Cap: {
            type: "number",
            description: "Buffer capacity between cell processing and packaging",
          },
          stepDelayMs: {
            type: "number",
            description: "Delay between simulation steps (milliseconds)",
          },
          failMTBF: {
            type: "number",
            description: "Mean time between failures for robot (minutes)",
          },
          failMTTR: {
            type: "number",
            description: "Mean time to repair for robot (minutes)",
          },
        },
      },
    },
    required: ["action"],
  },
};

// Tool 3: Factory Manual Access
export const factoryManualTool: MCPTool = {
  name: "read_factory_manual",
  description:
    "Read the factory operations manual. Can read the entire manual or search for specific sections. The manual contains specifications, optimization strategies, troubleshooting guides, and performance metrics.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          'Optional search query to find specific information in the manual (e.g., "buffer", "optimization", "throughput")',
      },
    },
  },
};

// Tool execution functions

export async function executeFactoryControl(
  factory: FactorySimulation,
  action: string
): Promise<ToolResult> {
  try {
    switch (action) {
      case "start":
        factory.start();
        return { success: true, data: { message: "Factory simulation started" } };

      case "stop":
        factory.stop();
        return { success: true, data: { message: "Factory simulation stopped" } };

      case "reset":
        factory.reset();
        return { success: true, data: { message: "Factory simulation reset" } };

      case "getState":
        const state = factory.getState();
        return { success: true, data: state };

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function executeFactoryParams(
  factory: FactorySimulation,
  action: string,
  params?: Partial<SimParams>
): Promise<ToolResult> {
  try {
    switch (action) {
      case "get":
        const currentParams = factory.getParams();
        return { success: true, data: currentParams };

      case "update":
        if (!params) {
          return { success: false, error: "No parameters provided for update" };
        }
        factory.updateParams(params);
        return {
          success: true,
          data: { message: "Parameters updated", newParams: factory.getParams() },
        };

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function readFactoryManual(query?: string): Promise<ToolResult> {
  try {
    const manualPath = path.join(
      process.cwd(),
      "server",
      "factory",
      "manual.md"
    );
    const manualContent = await fs.readFile(manualPath, "utf-8");

    if (query) {
      // Simple search: filter lines containing the query (case-insensitive)
      const lines = manualContent.split("\n");
      const matchingLines: string[] = [];
      const queryLower = query.toLowerCase();

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(queryLower)) {
          // Include context: 2 lines before and after
          const start = Math.max(0, i - 2);
          const end = Math.min(lines.length, i + 3);
          const context = lines.slice(start, end).join("\n");
          matchingLines.push(`\n--- Match at line ${i + 1} ---\n${context}\n`);
        }
      }

      if (matchingLines.length === 0) {
        return {
          success: true,
          data: {
            query,
            matches: 0,
            message: "No matches found in the manual",
          },
        };
      }

      return {
        success: true,
        data: {
          query,
          matches: matchingLines.length,
          results: matchingLines.join("\n---\n"),
        },
      };
    }

    // Return full manual if no query
    return {
      success: true,
      data: {
        content: manualContent,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export const factoryTools = [
  factoryControlTool,
  factoryParamsTool,
  factoryManualTool,
];
