import { useState, useEffect, useRef } from "react";

// Generate or retrieve session ID (only logs once per app load)
let sessionIdLogged = false;
function getSessionId(): string {
  const key = "factorySessionId";
  let sessionId = localStorage.getItem(key);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(key, sessionId);
    if (!sessionIdLogged) {
      console.log("Generated new session ID:", sessionId);
      sessionIdLogged = true;
    }
  } else {
    if (!sessionIdLogged) {
      console.log("Using existing session ID:", sessionId);
      sessionIdLogged = true;
    }
  }
  return sessionId;
}

interface ResourceStatus {
  capacity: number;
  inUse: number;
  queueLength: number;
  utilization: number;
}

interface RobotStatus extends ResourceStatus {
  isFailed: boolean;
  failureCount: number;
  lastFailureTime: number | null;
  estimatedNextFailureTime: number | null;
}

interface BufferStatus {
  capacity: number;
  items: number;
  getQueue: number;
  putQueue: number;
  utilization: number;
}

interface SimState {
  time: number;
  isRunning: boolean;
  resources: {
    cutter: ResourceStatus;
    robot: RobotStatus;
    heater: ResourceStatus;
    packer: ResourceStatus;
    buf12: BufferStatus;
    buf23: BufferStatus;
  };
  metrics: {
    completed: number;
    wip: number;
    avgCycleTime: number;
  };
}

interface PlannerMessage {
  type: string;
  timestamp: number;
  data: any;
}

function PlannerPage() {
  const [state, setState] = useState<SimState | null>(null);
  const [objective, setObjective] = useState("");
  const [maxIterations, setMaxIterations] = useState(10);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [messages, setMessages] = useState<PlannerMessage[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const plannerAbortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Session ID - stable across component lifecycle
  const sessionIdRef = useRef<string>(getSessionId());
  const sessionId = sessionIdRef.current;

  // Auto-scroll messages to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Set up SSE connection for real-time state updates
  useEffect(() => {
    const eventSource = new EventSource(`/api/factory/${sessionId}/stream`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setState(data);
      } catch (err) {
        console.error("Error parsing state:", err);
      }
    };

    eventSource.onerror = (error) => {
      console.error("SSE error:", error);
    };

    return () => {
      eventSource.close();
    };
  }, [sessionId]);

  const handleStartOptimization = async () => {
    if (!objective.trim() || isOptimizing) return;

    setIsOptimizing(true);
    setMessages([
      {
        type: "user",
        timestamp: Date.now(),
        data: { objective, maxIterations },
      },
    ]);

    const abortController = new AbortController();
    plannerAbortControllerRef.current = abortController;

    try {
      const response = await fetch(
        `/api/factory/${sessionId}/planner/optimize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal: objective, maxIterations }),
          signal: abortController.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body");
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const eventData = JSON.parse(line.slice(6));
              // Filter out simulation_progress events (too frequent) and done event
              if (
                eventData.type !== "done" &&
                eventData.type !== "planner:simulation_progress"
              ) {
                setMessages((prev) => [
                  ...prev,
                  {
                    type: eventData.type,
                    timestamp: Date.now(),
                    data: eventData,
                  },
                ]);
              }
            } catch (err) {
              console.error("Error parsing SSE data:", err);
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        console.error("Optimization error:", error);
        setMessages((prev) => [
          ...prev,
          {
            type: "error",
            timestamp: Date.now(),
            data: { message: error.message },
          },
        ]);
      }
    } finally {
      setIsOptimizing(false);
      plannerAbortControllerRef.current = null;
    }
  };

  const handleStopOptimization = () => {
    if (plannerAbortControllerRef.current) {
      plannerAbortControllerRef.current.abort();
      setIsOptimizing(false);
      setMessages((prev) => [
        ...prev,
        {
          type: "stopped",
          timestamp: Date.now(),
          data: { message: "Optimization stopped by user" },
        },
      ]);
    }
  };

  const ResourceCard = ({
    name,
    resource,
  }: {
    name: string;
    resource: ResourceStatus;
  }) => (
    <div className="bg-white rounded-lg p-3 shadow-sm">
      <h4 className="font-semibold text-gray-800 mb-2 text-sm">{name}</h4>
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-gray-600">In Use:</span>
          <span className="font-medium">
            {resource.inUse} / {resource.capacity}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-green-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${resource.utilization * 100}%` }}
          ></div>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-600">Queue:</span>
          <span className="font-medium">{resource.queueLength}</span>
        </div>
      </div>
    </div>
  );

  const RobotCard = ({ resource }: { resource: RobotStatus }) => {
    const timeSinceFailure =
      resource.lastFailureTime !== null
        ? (state?.time || 0) - resource.lastFailureTime
        : null;

    return (
      <div
        className={`bg-white rounded-lg p-3 shadow-sm transition-all duration-300 ${
          resource.isFailed ? "ring-2 ring-red-500 ring-offset-2" : ""
        }`}
      >
        <div className="flex justify-between items-start mb-2">
          <h4 className="font-semibold text-gray-800 text-sm">Robot</h4>
          {resource.isFailed && (
            <span className="px-1.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded animate-pulse">
              FAILED
            </span>
          )}
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-gray-600">In Use:</span>
            <span className="font-medium">
              {resource.inUse} / {resource.capacity}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-300 ${
                resource.isFailed ? "bg-red-500 animate-pulse" : "bg-green-500"
              }`}
              style={{ width: `${resource.utilization * 100}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-600">Queue:</span>
            <span className="font-medium">{resource.queueLength}</span>
          </div>

          {resource.failureCount > 0 && (
            <div className="pt-1 mt-1 border-t border-gray-200 space-y-0.5">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Failures:</span>
                <span className="font-semibold text-red-600">
                  {resource.failureCount}
                </span>
              </div>
              {timeSinceFailure !== null && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Last:</span>
                  <span className="font-semibold text-gray-700">
                    {timeSinceFailure.toFixed(1)} min ago
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const BufferCard = ({
    name,
    buffer,
  }: {
    name: string;
    buffer: BufferStatus;
  }) => (
    <div className="bg-white rounded-lg p-3 shadow-sm">
      <h4 className="font-semibold text-gray-800 mb-2 text-sm">{name}</h4>
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-gray-600">Items:</span>
          <span className="font-medium">
            {buffer.items} / {buffer.capacity}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${buffer.utilization * 100}%` }}
          ></div>
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>Get: {buffer.getQueue}</span>
          <span>Put: {buffer.putQueue}</span>
        </div>
      </div>
    </div>
  );

  const renderMessage = (msg: PlannerMessage) => {
    const { type, data } = msg;

    if (type === "user") {
      return (
        <div className="bg-blue-50 border-l-4 border-blue-500 p-3 rounded">
          <div className="font-semibold text-blue-900 mb-1">
            Optimization Goal
          </div>
          <div className="text-sm text-gray-700">{data.objective}</div>
          <div className="text-xs text-gray-500 mt-1">
            Max iterations: {data.maxIterations}
          </div>
        </div>
      );
    }

    if (type === "planner:start") {
      return (
        <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded">
          <div className="font-semibold text-green-900">
            Optimization Started
          </div>
          <div className="text-sm text-gray-700">Goal: {data.goal}</div>
        </div>
      );
    }

    // Legacy event - removed in favor of progress_evaluation
    if (type === "planner:goal_parsed") {
      return null;
    }

    if (type === "planner:phase") {
      return (
        <div className="bg-gray-50 p-2 rounded text-sm text-gray-600 italic">
          {data.message}
        </div>
      );
    }

    if (type === "planner:iteration_start") {
      return (
        <div className="bg-indigo-100 border-l-4 border-indigo-600 p-3 rounded">
          <div className="font-bold text-indigo-900">
            Iteration {data.iteration}
          </div>
        </div>
      );
    }

    if (type === "planner:metrics_before") {
      return (
        <div className="bg-blue-50 border border-blue-300 p-3 rounded">
          <div className="font-semibold text-blue-900 mb-1">
            📊 {data.label}
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm mt-2">
            <div>
              <div className="text-gray-600">Throughput</div>
              <div className="font-semibold">
                {data.metrics.throughput.toFixed(1)} items/hr
              </div>
            </div>
            <div>
              <div className="text-gray-600">Cycle Time</div>
              <div className="font-semibold">
                {data.metrics.avgCycleTime.toFixed(1)} min
              </div>
            </div>
            <div>
              <div className="text-gray-600">WIP</div>
              <div className="font-semibold">
                {data.metrics.avgWip.toFixed(1)}
              </div>
            </div>
          </div>
          {data.metrics.bottleneck && (
            <div className="mt-2 text-xs text-gray-600">
              Bottleneck: {data.metrics.bottleneck.resource} (
              {(data.metrics.bottleneck.utilization * 100).toFixed(1)}%
              utilization)
            </div>
          )}
        </div>
      );
    }

    if (type === "planner:metrics_after") {
      return (
        <div className="bg-green-50 border border-green-300 p-3 rounded">
          <div className="font-semibold text-green-900 mb-1">
            ✅ {data.label}
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm mt-2">
            <div>
              <div className="text-gray-600">Throughput</div>
              <div className="font-semibold">
                {data.metrics.throughput.toFixed(1)} items/hr
              </div>
            </div>
            <div>
              <div className="text-gray-600">Cycle Time</div>
              <div className="font-semibold">
                {data.metrics.avgCycleTime.toFixed(1)} min
              </div>
            </div>
            <div>
              <div className="text-gray-600">WIP</div>
              <div className="font-semibold">
                {data.metrics.avgWip.toFixed(1)}
              </div>
            </div>
          </div>
          {data.metrics.bottleneck && (
            <div className="mt-2 text-xs text-gray-600">
              Bottleneck: {data.metrics.bottleneck.resource} (
              {(data.metrics.bottleneck.utilization * 100).toFixed(1)}%
              utilization)
            </div>
          )}
          {data.duration > 0 && (
            <div className="mt-2 text-xs text-gray-500">
              Simulation time: {(data.duration / 1000).toFixed(1)}s
            </div>
          )}
        </div>
      );
    }

    if (type === "planner:proposal") {
      return (
        <div className="bg-yellow-50 border border-yellow-200 p-3 rounded">
          <div className="font-semibold text-yellow-900 mb-2">
            Proposed Changes
          </div>
          <div className="text-sm space-y-1">
            <div className="text-gray-700">
              <span className="font-medium">Analysis:</span>{" "}
              {data.proposal.analysis}
            </div>
            <div className="text-gray-700">
              <span className="font-medium">Changes:</span>{" "}
              {JSON.stringify(data.proposal.proposedChange)}
            </div>
            <div className="text-gray-700">
              <span className="font-medium">Expected:</span>{" "}
              {data.proposal.expectedOutcome}
            </div>
            <div className="text-xs text-gray-500">
              Confidence: {data.proposal.confidence}
            </div>
          </div>
        </div>
      );
    }

    if (type === "planner:validation") {
      const isValid = data.validation.isValid;
      return (
        <div
          className={`border p-3 rounded ${
            isValid
              ? "bg-green-50 border-green-200"
              : "bg-red-50 border-red-200"
          }`}
        >
          <div
            className={`font-semibold mb-1 ${
              isValid ? "text-green-900" : "text-red-900"
            }`}
          >
            {isValid ? "Validation Passed" : "Validation Failed"}
          </div>
          {!isValid && data.validation.warnings?.length > 0 && (
            <div className="text-sm text-red-700">
              {data.validation.warnings.map((w: string, idx: number) => (
                <div key={idx}>• {w}</div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (type === "planner:progress_evaluation") {
      return (
        <div className="bg-purple-50 border-l-4 border-purple-500 p-3 rounded">
          <div className="font-semibold text-purple-900 mb-2">
            🤖 LLM Progress Evaluation
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <div className="text-xs text-gray-600 font-medium mb-1">
                Goal Interpretation:
              </div>
              <div className="text-gray-800">{data.goalInterpretation}</div>
            </div>
            <div>
              <div className="text-xs text-gray-600 font-medium mb-1">
                Progress Assessment:
              </div>
              <div className="text-gray-800">{data.progressEvaluation}</div>
            </div>
            <div className="pt-2 border-t border-purple-200">
              <span className="inline-block bg-purple-200 text-purple-900 px-2 py-1 rounded text-xs font-medium">
                {data.progressSummary}
              </span>
            </div>
          </div>
        </div>
      );
    }

    if (type === "planner:params_updated") {
      return (
        <div className="bg-blue-50 border border-blue-200 p-2 rounded text-sm">
          <span className="font-medium">⚙️ Parameters updated:</span>{" "}
          {JSON.stringify(data.params)}
        </div>
      );
    }

    // Legacy events - removed
    if (type === "planner:simulation_complete") {
      return null;
    }

    if (type === "planner:goal_progress") {
      return null;
    }

    // Legacy event - removed in favor of progress_evaluation
    if (type === "planner:iteration_complete") {
      return null;
      // return (
      //   <div className="border-l-4 border-gray-400 p-2 rounded bg-gray-50">
      //     <div className="text-sm font-medium text-gray-700">
      //       ✓ Iteration {data.iteration} complete
      //       {data.progressSummary && (
      //         <span className="ml-2 text-gray-600">
      //           • {data.progressSummary}
      //         </span>
      //       )}
      //     </div>
      //   </div>
      // );
    }

    if (type === "planner:complete") {
      return (
        <div
          className={`border-l-4 p-4 rounded ${
            data.success
              ? "bg-green-100 border-green-600"
              : "bg-yellow-100 border-yellow-600"
          }`}
        >
          <div className="font-bold text-lg mb-2">
            {data.success ? "Optimization Complete!" : "Optimization Stopped"}
          </div>
          <div className="text-sm">{data.message}</div>
          {data.bestResult && (
            <div className="mt-2 text-sm">
              <div className="font-medium">Best Result:</div>
              <div>
                Throughput: {data.bestResult.metrics.throughput.toFixed(1)}{" "}
                items/hr
              </div>
              <div>
                Cycle Time: {data.bestResult.metrics.avgCycleTime.toFixed(1)}{" "}
                min
              </div>
            </div>
          )}
        </div>
      );
    }

    if (type === "error" || type === "planner:error") {
      return (
        <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded">
          <div className="font-semibold text-red-900">Error</div>
          <div className="text-sm text-red-700">
            {data.error || data.message}
          </div>
        </div>
      );
    }

    if (type === "stopped") {
      return (
        <div className="bg-orange-50 border-l-4 border-orange-500 p-3 rounded">
          <div className="font-semibold text-orange-900">Stopped</div>
          <div className="text-sm text-orange-700">{data.message}</div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Factory Visualization - Left Side */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-100">
        <div className="p-4 bg-white border-b border-gray-300">
          <div className="flex items-center gap-4">
            <div className="text-sm">
              <span className="text-gray-600">Time: </span>
              <span className="font-semibold">
                {state?.time.toFixed(2) || "0.00"} min
              </span>
            </div>
            <div
              className={`px-3 py-1 rounded-full text-sm font-semibold ${
                state?.isRunning
                  ? "bg-green-100 text-green-800"
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              {state?.isRunning ? "Running" : "Stopped"}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-5xl mx-auto space-y-4">
            {/* Metrics Panel */}
            <div className="bg-white rounded-lg p-4 shadow">
              <h3 className="text-lg font-bold mb-3 text-gray-800">
                Current Metrics
              </h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {state?.metrics.completed || 0}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    Completed Units
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {state?.metrics.wip || 0}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    Work in Progress
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {state?.metrics.avgCycleTime.toFixed(2) || "0.00"}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    Avg Cycle Time (min)
                  </div>
                </div>
              </div>
            </div>

            {/* Production Line */}
            <div className="bg-white rounded-lg p-4 shadow">
              <h3 className="text-lg font-bold mb-3 text-gray-800">
                Production Line
              </h3>

              {/* Flow Diagram */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex-1 flex items-center gap-2">
                  <div className="text-center flex flex-col items-center">
                    <div className="w-12 h-12 bg-blue-500 rounded-lg flex items-center justify-center text-white font-bold mb-1 text-sm">
                      S1
                    </div>
                    <div className="text-xs font-medium">Cutter</div>
                  </div>
                  <div className="flex-1 h-1 bg-gray-300"></div>
                  <div className="text-center flex flex-col items-center">
                    <div className="w-12 h-12 bg-green-500 rounded-lg flex items-center justify-center text-white font-bold mb-1 text-sm">
                      B1
                    </div>
                    <div className="text-xs font-medium">Buf 1-2</div>
                  </div>
                  <div className="flex-1 h-1 bg-gray-300"></div>
                  <div className="text-center flex flex-col items-center">
                    <div className="w-12 h-12 bg-yellow-500 rounded-lg flex items-center justify-center text-white font-bold mb-1 text-sm">
                      S2
                    </div>
                    <div className="text-xs font-medium">Cell</div>
                  </div>
                  <div className="flex-1 h-1 bg-gray-300"></div>
                  <div className="text-center flex flex-col items-center">
                    <div className="w-12 h-12 bg-green-500 rounded-lg flex items-center justify-center text-white font-bold mb-1 text-sm">
                      B2
                    </div>
                    <div className="text-xs font-medium">Buf 2-3</div>
                  </div>
                  <div className="flex-1 h-1 bg-gray-300"></div>
                  <div className="text-center flex flex-col items-center">
                    <div className="w-12 h-12 bg-purple-500 rounded-lg flex items-center justify-center text-white font-bold mb-1 text-sm">
                      S3
                    </div>
                    <div className="text-xs font-medium">Packer</div>
                  </div>
                </div>
              </div>

              {/* Resources Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                {state?.resources && (
                  <>
                    <ResourceCard
                      name="Cutter"
                      resource={state.resources.cutter}
                    />
                    <RobotCard resource={state.resources.robot} />
                    <ResourceCard
                      name="Heater"
                      resource={state.resources.heater}
                    />
                    <ResourceCard
                      name="Packer"
                      resource={state.resources.packer}
                    />
                  </>
                )}
              </div>

              {/* Buffers Grid */}
              <div className="grid grid-cols-2 gap-3">
                {state?.resources && (
                  <>
                    <BufferCard
                      name="Buffer 1-2"
                      buffer={state.resources.buf12}
                    />
                    <BufferCard
                      name="Buffer 2-3"
                      buffer={state.resources.buf23}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Planner Panel - Right Side */}
      <div className="w-2/5 bg-white border-l border-gray-300 flex flex-col shadow-lg">
        <div className="p-4 border-b border-gray-300 bg-indigo-600 text-white">
          <h2 className="text-lg font-bold">Automatic Optimization</h2>
          <p className="text-sm text-indigo-100">
            AI-powered planner optimizing your factory
          </p>
        </div>

        {/* Objective Input */}
        <div className="p-4 border-b border-gray-300 bg-gray-50">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Optimization Objective
          </label>
          <input
            type="text"
            placeholder="e.g., maximize throughput to 28 items/hour"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            disabled={isOptimizing}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-indigo-600 disabled:bg-gray-100 disabled:cursor-not-allowed mb-3"
          />
          <div className="flex items-center gap-4 mb-3">
            <label className="text-sm text-gray-700">
              Max Iterations:
              <input
                type="number"
                min="1"
                max="50"
                value={maxIterations}
                onChange={(e) => setMaxIterations(parseInt(e.target.value))}
                disabled={isOptimizing}
                className="ml-2 w-16 px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleStartOptimization}
              disabled={isOptimizing || !objective.trim()}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium transition-colors hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isOptimizing ? "Optimizing..." : "Start Optimization"}
            </button>
            {isOptimizing && (
              <button
                onClick={handleStopOptimization}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium transition-colors hover:bg-red-700"
              >
                Stop
              </button>
            )}
          </div>
        </div>

        {/* Messages Stream */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {messages.length === 0 && (
            <div className="text-center text-gray-500 text-sm mt-8">
              <p className="mb-2">Enter an optimization objective above.</p>
              <p className="text-xs">
                Examples: "maximize throughput", "reduce cycle time below 10
                minutes", "minimize WIP"
              </p>
            </div>
          )}
          {messages.map((msg, idx) => (
            <div key={idx}>{renderMessage(msg)}</div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}

export default PlannerPage;
