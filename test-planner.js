// test-planner.js - Simple test script for the planner via HTTP

const sessionId = "test-session-" + Date.now();
const baseUrl = "http://localhost:3000";

async function testPlanner() {
  console.log("=".repeat(60));
  console.log("PLANNER TEST");
  console.log("Session ID:", sessionId);
  console.log("=".repeat(60));
  console.log();

  try {
    // Start planner optimization via POST request with SSE response
    console.log("Starting planner optimization...");
    console.log(`Goal: "maximize throughput to 28 items/hour"`);
    console.log();

    const response = await fetch(
      `${baseUrl}/api/factory/${sessionId}/planner/optimize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          goal: "maximize throughput to 28 items/hour",
          maxIterations: 5,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Read SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          try {
            const event = JSON.parse(data);
            handleEvent(event);
          } catch (e) {
            console.error("Failed to parse event:", data);
          }
        }
      }
    }

    console.log();
    console.log("=".repeat(60));
    console.log("TEST COMPLETE");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

function handleEvent(event) {
  switch (event.type) {
    case "planner:start":
      console.log(`\n📋 PLANNER STARTED`);
      console.log(`   Goal: ${event.goal}`);
      console.log(`   Max Iterations: ${event.maxIterations}`);
      break;

    case "planner:goal_parsed":
      console.log(`\n🎯 GOAL PARSED`);
      console.log(`   Goals: ${event.objectives.goals.map(g => g.description).join(", ")}`);
      break;

    case "planner:iteration_start":
      console.log(`\n${"─".repeat(60)}`);
      console.log(`ITERATION ${event.iteration}`);
      console.log("─".repeat(60));
      break;

    case "planner:phase":
      console.log(`[${event.phase.toUpperCase()}] ${event.message}`);
      break;

    case "planner:metrics":
      const m = event.metrics;
      console.log(`\n📊 Current Metrics:`);
      console.log(`   Throughput: ${m.throughput.toFixed(1)} items/hour`);
      console.log(`   Cycle Time: ${m.avgCycleTime.toFixed(1)} minutes`);
      console.log(`   WIP: ${m.avgWip.toFixed(1)}`);
      if (m.bottleneck) {
        console.log(`   Bottleneck: ${m.bottleneck.resource} (${(m.bottleneck.utilization * 100).toFixed(1)}% util)`);
      }
      break;

    case "planner:proposal":
      const p = event.proposal;
      console.log(`\n💡 LLM Proposal:`);
      console.log(`   Analysis: ${p.analysis}`);
      console.log(`   Reasoning: ${p.reasoning}`);
      console.log(`   Change: ${JSON.stringify(p.proposedChange)}`);
      console.log(`   Expected: ${p.expectedOutcome}`);
      console.log(`   Confidence: ${p.confidence}`);
      break;

    case "planner:validation":
      if (event.validation.isValid) {
        console.log(`✓ Validation passed`);
      } else {
        console.log(`⚠ Validation warnings:`, event.validation.warnings);
      }
      break;

    case "planner:params_updated":
      console.log(`🔧 Parameters updated:`, event.params);
      break;

    case "planner:simulation_start":
      process.stdout.write(`🏃 Simulation running...`);
      break;

    case "planner:simulation_progress":
      // Show progress bar
      const progress = Math.floor(event.progress);
      if (progress % 20 === 0) {
        process.stdout.write(`.`);
      }
      break;

    case "planner:simulation_complete":
      console.log(` done! (${event.duration}ms)`);
      const sm = event.metrics;
      console.log(`   Result - Throughput: ${sm.throughput.toFixed(1)} items/hour`);
      break;

    case "planner:goal_progress":
      console.log(`\n📈 Goal Progress:`);
      for (const [key, status] of Object.entries(event.progress.goals)) {
        const emoji = status.achieved ? "✅" : "🔄";
        console.log(`   ${emoji} ${key}: ${status.current.toFixed(1)} / ${status.target}`);
      }
      console.log(`   Overall: ${(event.progress.overall * 100).toFixed(1)}%`);
      break;

    case "planner:iteration_complete":
      const improved = event.improved ? "✓ Improved" : "○ No improvement";
      console.log(`\n${improved}`);
      break;

    case "planner:complete":
      console.log(`\n${"=".repeat(60)}`);
      if (event.success) {
        console.log(`✅ SUCCESS: ${event.message}`);
      } else {
        console.log(`⏸️  STOPPED: ${event.message}`);
      }
      if (event.bestResult) {
        console.log(`\nBest Result:`);
        console.log(`   Throughput: ${event.bestResult.metrics.throughput.toFixed(1)} items/hour`);
        console.log(`   Cycle Time: ${event.bestResult.metrics.avgCycleTime.toFixed(1)} minutes`);
      }
      console.log("=".repeat(60));
      break;

    case "planner:error":
      console.error(`\n❌ ERROR: ${event.error}`);
      break;

    case "done":
      // Stream complete marker
      break;

    default:
      console.log("Unknown event:", event.type);
  }
}

// Run test
testPlanner().catch(console.error);
