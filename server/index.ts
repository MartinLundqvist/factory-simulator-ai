import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { defaultParams, SimParams } from "./FactorySimulation.js";
import { FactoryAgent } from "./factoryAgent.js";
import { SessionManager } from "./sessionManager.js";
import { PlannerAgent } from "./plannerAgent.js";
import { PlannerConfig } from "./plannerTypes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const isDevelopment = process.env.NODE_ENV !== "production";

// Configure CORS
const corsOptions = {
  origin: process.env.CORS_ORIGIN || (isDevelopment ? "*" : false),
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

// Initialize session manager
const sessionManager = new SessionManager();

// Map to store factory agents per session
const factoryAgents: Map<string, FactoryAgent> = new Map();

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    activeSessions: sessionManager.getSessionCount(),
  });
});

function getFactoryAgent(sessionId: string): FactoryAgent {
  if (!factoryAgents.has(sessionId)) {
    const session = sessionManager.getOrCreateSession(sessionId, defaultParams);
    factoryAgents.set(
      sessionId,
      new FactoryAgent(session.simulation, process.env.OPENAI_API_KEY || "")
    );
  }
  return factoryAgents.get(sessionId)!;
}

// Factory chat endpoint using AI SDK - returns UI message stream
app.post("/api/factory/:sessionId/chat-aisdk", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Messages array is required" });
    }

    const agent = getFactoryAgent(sessionId);

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
app.get("/api/factory/:sessionId/params", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.getOrCreateSession(sessionId, defaultParams);
    res.json(session.simulation.getParams());
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to get factory parameters" });
  }
});

// Update factory parameters
app.post("/api/factory/:sessionId/params", (req, res) => {
  try {
    const { sessionId } = req.params;
    const params: Partial<SimParams> = req.body;
    const session = sessionManager.getOrCreateSession(sessionId, {
      ...defaultParams,
      ...params,
    });
    session.simulation.updateParams(params);
    res.json({ success: true, params: session.simulation.getParams() });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to update factory parameters" });
  }
});

// Get current factory state
app.get("/api/factory/:sessionId/state", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.getOrCreateSession(sessionId, defaultParams);
    res.json(session.simulation.getState());
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to get factory state" });
  }
});

// Start factory simulation
app.post("/api/factory/:sessionId/start", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.getOrCreateSession(sessionId, defaultParams);
    session.simulation.start();
    res.json({ success: true, state: session.simulation.getState() });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to start factory simulation" });
  }
});

// Stop factory simulation
app.post("/api/factory/:sessionId/stop", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(400).json({ error: "No simulation running" });
    }
    session.simulation.stop();
    res.json({ success: true, state: session.simulation.getState() });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to stop factory simulation" });
  }
});

// Reset factory simulation
app.post("/api/factory/:sessionId/reset", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.getOrCreateSession(sessionId, defaultParams);
    session.simulation.reset();
    res.json({ success: true, state: session.simulation.getState() });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to reset factory simulation" });
  }
});

// SSE endpoint for real-time state streaming
app.get("/api/factory/:sessionId/stream", (req, res) => {
  const { sessionId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // Get or create session
  const session = sessionManager.getOrCreateSession(sessionId, defaultParams);

  // Add client to session
  sessionManager.addClient(sessionId, res);

  // Send initial state
  res.write(`data: ${JSON.stringify(session.simulation.getState())}\n\n`);

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

  session.simulation.on("state", stateHandler);
  session.simulation.on("complete", completeHandler);
  session.simulation.on("reset", resetHandler);

  // Clean up on client disconnect
  req.on("close", () => {
    sessionManager.removeClient(sessionId, res);
    session.simulation.off("state", stateHandler);
    session.simulation.off("complete", completeHandler);
    session.simulation.off("reset", resetHandler);
  });
});

// Planner SSE endpoint for streaming optimization progress
app.post("/api/factory/:sessionId/planner/optimize", async (req, res) => {
  const { sessionId } = req.params;
  const { goal, maxIterations = 10 } = req.body;

  if (!goal || typeof goal !== "string") {
    return res.status(400).json({ error: "Goal string is required" });
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    // Get or create session
    const session = sessionManager.getOrCreateSession(sessionId, defaultParams);

    // Send a comment to establish the SSE connection immediately
    res.write(`: connected\n\n`);

    // Create planner for this session
    const planner = new PlannerAgent(session.simulation);

    // Set up event listeners to stream all planner events
    const eventHandler = (event: any) => {
      console.log("[SSE] Sending event:", event.type);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Listen to all planner events
    planner.on("planner:start", eventHandler);
    planner.on("planner:goal_parsed", eventHandler);
    planner.on("planner:iteration_start", eventHandler);
    planner.on("planner:phase", eventHandler);
    planner.on("planner:metrics", eventHandler);
    planner.on("planner:proposal", eventHandler);
    planner.on("planner:validation", eventHandler);
    planner.on("planner:params_updated", eventHandler);
    planner.on("planner:simulation_start", eventHandler);
    // planner.on("planner:simulation_progress", eventHandler);
    planner.on("planner:simulation_complete", eventHandler);
    planner.on("planner:goal_progress", eventHandler);
    planner.on("planner:iteration_complete", eventHandler);
    planner.on("planner:complete", eventHandler);
    planner.on("planner:error", eventHandler);

    // Handle client disconnect (use res, not req)
    res.on("close", () => {
      console.log(`Client disconnected from planner stream: ${sessionId}`);
      planner.stop();
      planner.removeAllListeners();
    });

    // Start optimization
    const config: PlannerConfig = {
      maxIterations,
      stopOnGoalAchieved: true,
    };

    await planner.optimize(goal, config);

    // Send completion marker and close
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (error) {
    console.error("Planner error:", error);
    res.write(
      `data: ${JSON.stringify({
        type: "planner:error",
        error: error instanceof Error ? error.message : String(error),
      })}\n\n`
    );
    res.end();
  }
});

// Serve static files in production
if (!isDevelopment) {
  const clientPath = path.join(__dirname, "../client");
  app.use(express.static(clientPath));

  // Handle client-side routing - serve index.html for any non-API routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientPath, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`Health check available at: http://localhost:${port}/api/health`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  sessionManager.shutdown();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT signal received: closing HTTP server");
  sessionManager.shutdown();
  process.exit(0);
});
