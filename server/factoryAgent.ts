import {
  streamText,
  stepCountIs,
  convertToModelMessages,
  UIMessage,
  tool,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { FactorySimulation } from "./FactorySimulation.js";
import {
  executeFactoryControl,
  executeFactoryParams,
  readFactoryManual,
} from "./factoryTools.js";

export class FactoryAgent {
  private factory: FactorySimulation;
  private systemPrompt: string;

  constructor(factory: FactorySimulation, _apiKey: string) {
    this.factory = factory;

    // Store system prompt
    this.systemPrompt = `You are an AI assistant specialized in optimizing and managing a production line factory simulation.

This is a discrete event simulation (DES) of a production line with the following stages:
1. **Cutting Station**: Raw materials are cut (uses Cutter resource)
2. **Cell Processing**: Parts are processed using Robot and Heater resources
3. **Packaging Station**: Finished parts are packaged (uses Packer resource)

Between stages are buffers (buf12 and buf23) that store work-in-progress items.

You have access to three tools:

1. **factory_control**: Start, stop, reset the simulation, or get current state
2. **factory_params**: View or modify simulation parameters (arrival rates, processing times, resource capacities, buffer sizes, failure rates)
3. **read_factory_manual**: Access the factory operations manual for specifications, optimization strategies, and troubleshooting

Your expertise:
- **Throughput Optimization**: Identify bottlenecks and recommend capacity/buffer adjustments
- **WIP Management**: Balance work-in-progress levels using buffer sizing
- **Resource Utilization**: Analyze and improve utilization of cutters, robots, heaters, and packers
- **Cycle Time Reduction**: Recommend processing time improvements
- **Reliability**: Manage robot failure parameters (MTBF/MTTR) and their impact on performance
- **Little's Law**: Use WIP = Throughput × CycleTime to validate simulation results

Key Performance Indicators:
- Throughput (items/hour)
- Average cycle time (minutes)
- Average WIP (items in system)
- Resource utilization (%)
- Buffer utilization (%)

When analyzing the factory:
- Check current state and metrics first
- Always refer to the manual to understand normal operating ranges
- Identify bottlenecks (resources with high utilization or long queues)
- Recommend parameter changes to improve performance
- Always explain the rationale behind optimization suggestions

Always be analytical, data-driven, and focused on continuous improvement.`;
  }

  // Stream response using UI message format for React integration
  async streamUI(messages: UIMessage[]) {
    // Define tools for the AI SDK
    const tools = {
      factory_control: tool({
        description:
          "Control the factory simulation. Available actions: start, stop, reset, getState.",
        inputSchema: z.object({
          action: z
            .enum(["start", "stop", "reset", "getState"])
            .describe("The action to perform on the factory simulation"),
        }),
        execute: async ({
          action,
        }: {
          action: "start" | "stop" | "reset" | "getState";
        }) => {
          console.log(`[FactoryAgentAISDK] Executing factory_control:`, action);
          return await executeFactoryControl(this.factory, action);
        },
      }),
      factory_params: tool({
        description:
          "Get or update factory simulation parameters. Can read all parameters or update specific ones. Use 'get' to retrieve current parameters, or 'update' with a params object to modify specific parameters.",
        inputSchema: z.object({
          action: z
            .enum(["get", "update"])
            .describe("Get current parameters or update them"),
          params: z
            .object({
              randomSeed: z
                .number()
                .optional()
                .describe("Random seed for reproducibility"),
              simHours: z
                .number()
                .optional()
                .describe("Simulation duration in hours"),
              arrivalMean: z
                .number()
                .optional()
                .describe("Mean time between arrivals (minutes)"),
              cutTime: z
                .number()
                .optional()
                .describe("Base cutting time (minutes)"),
              cellTime: z
                .number()
                .optional()
                .describe("Base cell processing time (minutes)"),
              packTime: z
                .number()
                .optional()
                .describe("Base packaging time (minutes)"),
              cutTimeVarLow: z
                .number()
                .optional()
                .describe("Lower variance coefficient for cutting time"),
              cutTimeVarHigh: z
                .number()
                .optional()
                .describe("Upper variance coefficient for cutting time"),
              cellTimeVarLow: z
                .number()
                .optional()
                .describe(
                  "Lower variance coefficient for cell processing time"
                ),
              cellTimeVarHigh: z
                .number()
                .optional()
                .describe(
                  "Upper variance coefficient for cell processing time"
                ),
              packTimeVarLow: z
                .number()
                .optional()
                .describe("Lower variance coefficient for packaging time"),
              packTimeVarHigh: z
                .number()
                .optional()
                .describe("Upper variance coefficient for packaging time"),
              cutterCapacity: z
                .number()
                .optional()
                .describe("Number of cutter resources"),
              robotCapacity: z
                .number()
                .optional()
                .describe("Number of robot resources"),
              heaterCapacity: z
                .number()
                .optional()
                .describe("Number of heater resources"),
              packerCapacity: z
                .number()
                .optional()
                .describe("Number of packer resources"),
              buf12Cap: z
                .number()
                .optional()
                .describe(
                  "Buffer capacity between cutting and cell processing"
                ),
              buf23Cap: z
                .number()
                .optional()
                .describe(
                  "Buffer capacity between cell processing and packaging"
                ),
              stepDelayMs: z
                .number()
                .optional()
                .describe("Delay between simulation steps (milliseconds)"),
              failMTBF: z
                .number()
                .optional()
                .describe("Mean time between failures for robot (minutes)"),
              failMTTR: z
                .number()
                .optional()
                .describe("Mean time to repair for robot (minutes)"),
            })
            .optional()
            .describe(
              "Parameters to update (only used with 'update' action). Provide an object with one or more parameter fields to update."
            ),
        }),
        execute: async ({
          action,
          params,
        }: {
          action: "get" | "update";
          params?: any;
        }) => {
          console.log(
            `[FactoryAgentAISDK] Executing factory_params:`,
            action,
            params
          );
          return await executeFactoryParams(this.factory, action, params);
        },
      }),
      read_factory_manual: tool({
        description:
          "Read the factory operations manual. Can read the entire manual or search for specific sections. The manual contains specifications, optimization strategies, troubleshooting guides, and performance metrics.",
        inputSchema: z.object({
          query: z
            .string()
            .optional()
            .describe(
              'Optional search query to find specific information in the manual (e.g., "buffer", "optimization", "throughput")'
            ),
        }),
        execute: async ({ query }: { query?: string }) => {
          console.log(
            `[FactoryAgentAISDK] Executing read_factory_manual:`,
            query
          );
          return await readFactoryManual(query);
        },
      }),
    };

    // Stream the response with UI message format
    const result = streamText({
      model: openai("gpt-4o-mini"),
      system: this.systemPrompt,
      messages: convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(10), // Allow up to 10 tool call rounds
    });

    // Return response in UI message stream format
    return result;
  }
}
