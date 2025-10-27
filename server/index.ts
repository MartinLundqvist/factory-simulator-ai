import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
  FactorySimulation,
  defaultParams,
  SimParams,
} from "./FactorySimulation.ts";
import { FactoryAgent } from "./factoryAgent.ts";

dotenv.config();

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Initialize factory simulation
let factorySim: FactorySimulation | null = null;
const factoryClients: Set<express.Response> = new Set();

// Initialize factory AI SDK agent (lazy initialization)
let factoryAgent: FactoryAgent | null = null;

function getFactoryAgent(): FactoryAgent {
  if (!factorySim) {
    factorySim = new FactorySimulation(defaultParams);
  }
  if (!factoryAgent) {
    factoryAgent = new FactoryAgent(
      factorySim,
      process.env.OPENAI_API_KEY || ""
    );
  }
  return factoryAgent;
}

// Factory chat endpoint using AI SDK - returns UI message stream
app.post("/api/factory/chat-aisdk", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Messages array is required" });
    }

    const agent = getFactoryAgent();

    // Use the AI SDK factory agent's UI stream
    const response = await agent.streamUI(messages);

    // Pipe the response directly
    response.pipeUIMessageStreamToResponse(res);
    // return response;
  } catch (error) {
    console.error("Error:", error);
    res
      .status(500)
      .json({ error: "Failed to get response from Factory AI SDK" });
  }
});

// Factory simulation endpoints

// Get current factory parameters
app.get("/api/factory/params", (_req, res) => {
  try {
    if (!factorySim) {
      factorySim = new FactorySimulation(defaultParams);
    }
    res.json(factorySim.getParams());
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to get factory parameters" });
  }
});

// Update factory parameters
app.post("/api/factory/params", (req, res) => {
  try {
    const params: Partial<SimParams> = req.body;
    if (!factorySim) {
      factorySim = new FactorySimulation({ ...defaultParams, ...params });
    } else {
      factorySim.updateParams(params);
    }
    res.json({ success: true, params: factorySim.getParams() });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to update factory parameters" });
  }
});

// Get current factory state
app.get("/api/factory/state", (_req, res) => {
  try {
    if (!factorySim) {
      factorySim = new FactorySimulation(defaultParams);
    }
    res.json(factorySim.getState());
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to get factory state" });
  }
});

// Start factory simulation
app.post("/api/factory/start", (_req, res) => {
  try {
    if (!factorySim) {
      factorySim = new FactorySimulation(defaultParams);
    }
    factorySim.start();
    res.json({ success: true, state: factorySim.getState() });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to start factory simulation" });
  }
});

// Stop factory simulation
app.post("/api/factory/stop", (_req, res) => {
  try {
    if (!factorySim) {
      return res.status(400).json({ error: "No simulation running" });
    }
    factorySim.stop();
    res.json({ success: true, state: factorySim.getState() });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to stop factory simulation" });
  }
});

// Reset factory simulation
app.post("/api/factory/reset", (_req, res) => {
  try {
    if (!factorySim) {
      factorySim = new FactorySimulation(defaultParams);
    }
    factorySim.reset();
    res.json({ success: true, state: factorySim.getState() });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to reset factory simulation" });
  }
});

// SSE endpoint for real-time state streaming
app.get("/api/factory/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // Add client to set
  factoryClients.add(res);

  // Initialize simulation if needed
  if (!factorySim) {
    factorySim = new FactorySimulation(defaultParams);
  }

  // Send initial state
  res.write(`data: ${JSON.stringify(factorySim.getState())}\n\n`);

  // Set up event listeners
  const stateHandler = (state: any) => {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  };

  const completeHandler = (state: any) => {
    res.write(`data: ${JSON.stringify({ ...state, complete: true })}\n\n`);
  };

  const resetHandler = (state: any) => {
    res.write(`data: ${JSON.stringify({ ...state, reset: true })}\n\n`);
  };

  factorySim.on("state", stateHandler);
  factorySim.on("complete", completeHandler);
  factorySim.on("reset", resetHandler);

  // Clean up on client disconnect
  req.on("close", () => {
    factoryClients.delete(res);
    if (factorySim) {
      factorySim.off("state", stateHandler);
      factorySim.off("complete", completeHandler);
      factorySim.off("reset", resetHandler);
    }
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
