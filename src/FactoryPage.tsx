import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

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

interface SimParams {
  randomSeed: number;
  simHours: number;
  arrivalMean: number;
  cutTime: number;
  cellTime: number;
  packTime: number;
  cutTimeVarLow: number;
  cutTimeVarHigh: number;
  cellTimeVarLow: number;
  cellTimeVarHigh: number;
  packTimeVarLow: number;
  packTimeVarHigh: number;
  cutterCapacity: number;
  robotCapacity: number;
  heaterCapacity: number;
  packerCapacity: number;
  buf12Cap: number;
  buf23Cap: number;
  stepDelayMs: number;
  failMTBF: number;
  failMTTR: number;
}

function FactoryPage() {
  const [state, setState] = useState<SimState | null>(null);
  const [params, setParams] = useState<SimParams | null>(null);
  const [editedParams, setEditedParams] = useState<Partial<SimParams>>({});
  const [showParamsForm, setShowParamsForm] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Chat state
  const [showChat, setShowChat] = useState(false);
  const [showToolCalls, setShowToolCalls] = useState(true);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // AI SDK useChat hook
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/factory/chat-aisdk",
    }),
  });

  const [input, setInput] = useState("");

  // Auto-scroll chat to bottom when messages change
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Fetch initial parameters
  useEffect(() => {
    fetch("/api/factory/params")
      .then((res) => res.json())
      .then((data) => {
        setParams(data);
        setEditedParams(data);
      })
      .catch((err) => console.error("Error fetching params:", err));
  }, []);

  // Set up SSE connection for real-time state updates
  useEffect(() => {
    const eventSource = new EventSource("/api/factory/stream");
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
  }, []);

  const handleStart = async () => {
    try {
      await fetch("/api/factory/start", { method: "POST" });
    } catch (err) {
      console.error("Error starting simulation:", err);
    }
  };

  const handleStop = async () => {
    try {
      await fetch("/api/factory/stop", { method: "POST" });
    } catch (err) {
      console.error("Error stopping simulation:", err);
    }
  };

  const handleReset = async () => {
    try {
      await fetch("/api/factory/reset", { method: "POST" });
    } catch (err) {
      console.error("Error resetting simulation:", err);
    }
  };

  const handleUpdateParams = async () => {
    try {
      const response = await fetch("/api/factory/params", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editedParams),
      });
      const data = await response.json();
      setParams(data.params);
      setShowParamsForm(false);
    } catch (err) {
      console.error("Error updating params:", err);
    }
  };

  const handleRefreshParams = async () => {
    try {
      const response = await fetch("/api/factory/params");
      if (response.ok) {
        const data = await response.json();
        setParams(data);
        setEditedParams(data);
      }
    } catch (err) {
      console.error("Error refreshing params:", err);
    }
  };

  // Handle message submission
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInput = input.trim();
    if (!trimmedInput || status !== "ready") return;

    sendMessage({ text: trimmedInput });
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  const ResourceCard = ({
    name,
    resource,
  }: {
    name: string;
    resource: ResourceStatus;
  }) => (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h4 className="font-semibold text-gray-800 mb-3">{name}</h4>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">In Use:</span>
          <span className="font-medium">
            {resource.inUse} / {resource.capacity}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className="bg-green-500 h-3 rounded-full transition-all duration-300"
            style={{ width: `${resource.utilization * 100}%` }}
          ></div>
        </div>
        <div className="flex justify-between text-sm">
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
        className={`bg-white rounded-lg p-4 shadow-sm transition-all duration-300 ${
          resource.isFailed ? "ring-2 ring-red-500 ring-offset-2" : ""
        }`}
      >
        <div className="flex justify-between items-start mb-3">
          <h4 className="font-semibold text-gray-800">Robot</h4>
          {resource.isFailed && (
            <span className="px-2 py-1 bg-red-500 text-white text-xs font-bold rounded animate-pulse">
              FAILED
            </span>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">In Use:</span>
            <span className="font-medium">
              {resource.inUse} / {resource.capacity}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all duration-300 ${
                resource.isFailed ? "bg-red-500 animate-pulse" : "bg-green-500"
              }`}
              style={{ width: `${resource.utilization * 100}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Queue:</span>
            <span className="font-medium">{resource.queueLength}</span>
          </div>

          {/* Failure Statistics */}
          <div className="pt-2 mt-2 border-t border-gray-200 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Total Failures:</span>
              <span
                className={`font-semibold ${
                  resource.failureCount > 0 ? "text-red-600" : "text-gray-700"
                }`}
              >
                {resource.failureCount}
              </span>
            </div>
            {timeSinceFailure !== null && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Last Failure:</span>
                <span className="font-semibold text-gray-700">
                  {timeSinceFailure.toFixed(1)} min ago
                </span>
              </div>
            )}
            {resource.isFailed && (
              <div className="mt-2 text-xs text-red-600 font-medium text-center">
                ⚠ Under Repair
              </div>
            )}
          </div>
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
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h4 className="font-semibold text-gray-800 mb-3">{name}</h4>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Items:</span>
          <span className="font-medium">
            {buffer.items} / {buffer.capacity}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className="bg-blue-500 h-3 rounded-full transition-all duration-300"
            style={{ width: `${buffer.utilization * 100}%` }}
          ></div>
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>Get Queue: {buffer.getQueue}</span>
          <span>Put Queue: {buffer.putQueue}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Control Panel */}
        <div className="bg-white border-b border-gray-300 p-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-3">
              <button
                onClick={handleStart}
                disabled={state?.isRunning}
                className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium transition-colors hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Start
              </button>
              <button
                onClick={handleStop}
                disabled={!state?.isRunning}
                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium transition-colors hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Stop
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg font-medium transition-colors hover:bg-gray-700"
              >
                Reset
              </button>
              <button
                onClick={() => setShowParamsForm(!showParamsForm)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium transition-colors hover:bg-blue-700"
              >
                {showParamsForm ? "Hide" : "Show"} Parameters
              </button>
              <button
                onClick={() => setShowChat(!showChat)}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg font-medium transition-colors hover:bg-purple-700"
              >
                {showChat ? "Hide" : "Show"} AI Assistant
              </button>
            </div>
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
        </div>

        {/* Parameters Form */}
        {showParamsForm && params && (
          <div className="bg-gray-50 border-b border-gray-300 p-4 overflow-y-auto max-h-64">
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Simulation Hours
                </label>
                <input
                  type="number"
                  value={editedParams.simHours ?? params.simHours}
                  onChange={(e) =>
                    setEditedParams({
                      ...editedParams,
                      simHours: parseFloat(e.target.value),
                    })
                  }
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Arrival Mean (min)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={editedParams.arrivalMean ?? params.arrivalMean}
                  onChange={(e) =>
                    setEditedParams({
                      ...editedParams,
                      arrivalMean: parseFloat(e.target.value),
                    })
                  }
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Cut Time (min)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={editedParams.cutTime ?? params.cutTime}
                  onChange={(e) =>
                    setEditedParams({
                      ...editedParams,
                      cutTime: parseFloat(e.target.value),
                    })
                  }
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Cell Time (min)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={editedParams.cellTime ?? params.cellTime}
                  onChange={(e) =>
                    setEditedParams({
                      ...editedParams,
                      cellTime: parseFloat(e.target.value),
                    })
                  }
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Pack Time (min)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={editedParams.packTime ?? params.packTime}
                  onChange={(e) =>
                    setEditedParams({
                      ...editedParams,
                      packTime: parseFloat(e.target.value),
                    })
                  }
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Step Delay (ms)
                </label>
                <input
                  type="number"
                  value={editedParams.stepDelayMs ?? params.stepDelayMs}
                  onChange={(e) =>
                    setEditedParams({
                      ...editedParams,
                      stepDelayMs: parseInt(e.target.value),
                    })
                  }
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Buffer 1-2 Capacity
                </label>
                <input
                  type="number"
                  value={editedParams.buf12Cap ?? params.buf12Cap}
                  onChange={(e) =>
                    setEditedParams({
                      ...editedParams,
                      buf12Cap: parseInt(e.target.value),
                    })
                  }
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Buffer 2-3 Capacity
                </label>
                <input
                  type="number"
                  value={editedParams.buf23Cap ?? params.buf23Cap}
                  onChange={(e) =>
                    setEditedParams({
                      ...editedParams,
                      buf23Cap: parseInt(e.target.value),
                    })
                  }
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button
                onClick={handleUpdateParams}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium transition-colors hover:bg-blue-700"
              >
                Apply Parameters
              </button>
              <button
                onClick={handleRefreshParams}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg font-medium transition-colors hover:bg-gray-700"
              >
                Refresh from Server
              </button>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-100">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Metrics Panel */}
            <div className="bg-white rounded-lg p-6 shadow">
              <h3 className="text-xl font-bold mb-4 text-gray-800">
                Simulation Metrics
              </h3>
              <div className="grid grid-cols-3 gap-6">
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600">
                    {state?.metrics.completed || 0}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    Completed Units
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-600">
                    {state?.metrics.wip || 0}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    Work in Progress
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-purple-600">
                    {state?.metrics.avgCycleTime.toFixed(2) || "0.00"}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    Avg Cycle Time (min)
                  </div>
                </div>
              </div>
            </div>

            {/* Production Line Visualization */}
            <div className="bg-white rounded-lg p-6 shadow">
              <h3 className="text-xl font-bold mb-4 text-gray-800">
                Production Line
              </h3>

              {/* Flow Diagram */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex-1 flex items-center gap-4">
                  <div className="text-center flex flex-col items-center">
                    <div className="w-16 h-16 bg-blue-500 rounded-lg flex items-center justify-center text-white font-bold mb-2">
                      S1
                    </div>
                    <div className="text-xs font-medium">Cutter</div>
                  </div>
                  <div className="flex-1 h-1 bg-gray-300"></div>
                  <div className="text-center flex flex-col items-center">
                    <div className="w-16 h-16 bg-green-500 rounded-lg flex items-center justify-center text-white font-bold mb-2">
                      B1
                    </div>
                    <div className="text-xs font-medium">Buffer 1-2</div>
                  </div>
                  <div className="flex-1 h-1 bg-gray-300"></div>
                  <div className="text-center flex flex-col items-center">
                    <div className="w-16 h-16 bg-yellow-500 rounded-lg flex items-center justify-center text-white font-bold mb-2">
                      S2
                    </div>
                    <div className="text-xs font-medium leading-tight space-y-0">
                      <div>Cell</div>
                      <div className="text-gray-500">(Robot+Heater)</div>
                    </div>
                  </div>
                  <div className="flex-1 h-1 bg-gray-300"></div>
                  <div className="text-center flex flex-col items-center">
                    <div className="w-16 h-16 bg-green-500 rounded-lg flex items-center justify-center text-white font-bold mb-2">
                      B2
                    </div>
                    <div className="text-xs font-medium">Buffer 2-3</div>
                  </div>
                  <div className="flex-1 h-1 bg-gray-300"></div>
                  <div className="text-center flex flex-col items-center">
                    <div className="w-16 h-16 bg-purple-500 rounded-lg flex items-center justify-center text-white font-bold mb-2">
                      S3
                    </div>
                    <div className="text-xs font-medium">Packer</div>
                  </div>
                </div>
              </div>

              {/* Resources Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
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
              <div className="grid grid-cols-2 gap-4">
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

      {/* Chat Panel - Collapsible Side Panel */}
      {showChat && (
        <div className="w-1/2 bg-white border-l border-gray-300 flex flex-col shadow-lg">
          <div className="p-4 border-b border-gray-300 bg-purple-600 text-white">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold">
                  Factory AI Assistant (AI SDK)
                </h2>
                <p className="text-sm text-purple-100">
                  Expert in factory optimization
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={showToolCalls}
                  onChange={(e) => setShowToolCalls(e.target.checked)}
                  className="w-4 h-4 cursor-pointer"
                />
                <span>Show tool calls</span>
              </label>
            </div>
          </div>

          {/* Chat Messages */}
          <div
            className="flex-1 overflow-y-auto p-4 flex flex-col gap-3"
            ref={chatContainerRef}
          >
            {messages.length === 0 && (
              <div className="text-center text-gray-500 text-sm mt-8">
                <p className="mb-2">
                  👋 Hi! I'm your factory optimization assistant.
                </p>
                <p className="text-xs">
                  Ask me about throughput, bottlenecks, or optimization
                  strategies!
                </p>
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[85%] px-3 py-2 rounded-lg break-words text-sm ${
                  message.role === "user"
                    ? "self-end bg-purple-600 text-white"
                    : "self-start bg-gray-200 text-gray-800 flex flex-col gap-2"
                }`}
              >
                {message.role === "user" ? (
                  <div className="whitespace-pre-wrap">
                    {message.parts
                      .filter((part) => part.type === "text")
                      .map((part, idx) => (
                        <span key={idx}>{"text" in part ? part.text : ""}</span>
                      ))}
                  </div>
                ) : (
                  <>
                    {message.parts.map((part, partIndex) => {
                      // Render text parts
                      if (part.type === "text") {
                        return (
                          <ReactMarkdown
                            key={partIndex}
                            remarkPlugins={[remarkGfm]}
                            className="prose prose-sm max-w-none"
                            components={{
                              h1: ({ node, ...props }) => (
                                <h1
                                  className="text-base font-bold mt-2 mb-1"
                                  {...props}
                                />
                              ),
                              h2: ({ node, ...props }) => (
                                <h2
                                  className="text-sm font-bold mt-2 mb-1"
                                  {...props}
                                />
                              ),
                              h3: ({ node, ...props }) => (
                                <h3
                                  className="text-sm font-bold mt-1 mb-1"
                                  {...props}
                                />
                              ),
                              p: ({ node, ...props }) => (
                                <p className="mb-1 last:mb-0" {...props} />
                              ),
                              ul: ({ node, ...props }) => (
                                <ul
                                  className="list-disc list-inside mb-1 ml-1"
                                  {...props}
                                />
                              ),
                              ol: ({ node, ...props }) => (
                                <ol
                                  className="list-decimal list-inside mb-1 ml-1"
                                  {...props}
                                />
                              ),
                              li: ({ node, ...props }) => (
                                <li className="mb-0.5" {...props} />
                              ),
                              code: ({ node, ...props }: any) =>
                                props.inline ? (
                                  <code
                                    className="bg-gray-300 px-1 py-0.5 rounded text-xs"
                                    {...props}
                                  />
                                ) : (
                                  <code
                                    className="block bg-gray-300 p-2 rounded text-xs overflow-x-auto mb-1"
                                    {...props}
                                  />
                                ),
                              pre: ({ node, ...props }) => (
                                <pre
                                  className="bg-gray-300 p-2 rounded overflow-x-auto mb-1"
                                  {...props}
                                />
                              ),
                              blockquote: ({ node, ...props }) => (
                                <blockquote
                                  className="border-l-2 border-gray-400 pl-2 italic mb-1"
                                  {...props}
                                />
                              ),
                              table: ({ node, ...props }) => (
                                <div className="overflow-x-auto mb-1">
                                  <table
                                    className="min-w-full border-collapse border border-gray-400 text-xs"
                                    {...props}
                                  />
                                </div>
                              ),
                              th: ({ node, ...props }) => (
                                <th
                                  className="border border-gray-400 px-1 py-0.5 bg-gray-300 font-bold"
                                  {...props}
                                />
                              ),
                              td: ({ node, ...props }) => (
                                <td
                                  className="border border-gray-400 px-1 py-0.5"
                                  {...props}
                                />
                              ),
                            }}
                          >
                            {part.type === "text" ? part.text : ""}
                          </ReactMarkdown>
                        );
                      }

                      // Render tool call parts
                      if (part.type.startsWith("tool-")) {
                        // Skip rendering if showToolCalls is false
                        if (!showToolCalls) {
                          return null;
                        }

                        const toolName = part.type.replace("tool-", "");
                        const hasOutput =
                          "output" in part && part.output !== undefined;
                        const hasError = "errorText" in part && part.errorText;

                        return (
                          <div
                            key={partIndex}
                            className={`border rounded p-2 text-xs ${
                              hasError
                                ? "bg-red-50 border-red-200"
                                : hasOutput
                                ? "bg-green-50 border-green-200"
                                : "bg-blue-50 border-blue-200"
                            }`}
                          >
                            <div
                              className={`font-semibold mb-1 flex items-center gap-1 ${
                                hasError
                                  ? "text-red-700"
                                  : hasOutput
                                  ? "text-green-700"
                                  : "text-blue-700"
                              }`}
                            >
                              <span>
                                {hasError ? "✗" : hasOutput ? "✓" : "🔧"}
                              </span>
                              <span>
                                {hasError
                                  ? "Tool error"
                                  : hasOutput
                                  ? "Tool result"
                                  : "Calling tool"}
                                : {toolName}
                              </span>
                            </div>

                            {"input" in part && part.input !== undefined && (
                              <div className="text-gray-700 mb-1">
                                <div className="text-gray-600 text-[10px] uppercase mb-0.5">
                                  Input:
                                </div>
                                <pre className="whitespace-pre-wrap overflow-x-auto">
                                  {JSON.stringify(part.input, null, 2)}
                                </pre>
                              </div>
                            )}

                            {hasOutput &&
                              "output" in part &&
                              part.output !== undefined && (
                                <div className="text-gray-700">
                                  <div className="text-gray-600 text-[10px] uppercase mb-0.5">
                                    Result:
                                  </div>
                                  <pre className="whitespace-pre-wrap overflow-x-auto max-h-40">
                                    {JSON.stringify(part.output, null, 2)}
                                  </pre>
                                </div>
                              )}

                            {hasError &&
                              "errorText" in part &&
                              part.errorText && (
                                <div className="text-red-700">
                                  <div className="text-red-600 text-[10px] uppercase mb-0.5">
                                    Error:
                                  </div>
                                  <pre className="whitespace-pre-wrap overflow-x-auto">
                                    {String(part.errorText)}
                                  </pre>
                                </div>
                              )}
                          </div>
                        );
                      }

                      return null;
                    })}
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Chat Input */}
          <form
            onSubmit={handleSendMessage}
            className="p-3 border-t border-gray-300 flex gap-2"
          >
            <input
              type="text"
              placeholder="Ask about optimization..."
              autoComplete="off"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={status !== "ready"}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-purple-600 disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={status !== "ready"}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium cursor-pointer transition-colors hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {status === "streaming" ? "..." : "Send"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default FactoryPage;
