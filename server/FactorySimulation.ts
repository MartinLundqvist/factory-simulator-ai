// FactorySimulation.ts - Refactored for API control
import { EventEmitter } from "events";
import {
  TimescaleDBClient,
  TimescaleDBConfig,
  TelemetryData,
} from "./timescaleDB.js";

/***********************
 * Minimal DES engine
 ***********************/
type EngineEvent = { t: number; action: () => void };

class PriorityQueue {
  private a: EngineEvent[] = [];
  push(e: EngineEvent) {
    this.a.push(e);
    this.a.sort((x, y) => x.t - y.t);
  }
  shift(): EngineEvent | undefined {
    return this.a.shift();
  }
  get length() {
    return this.a.length;
  }
}

class Env {
  now = 0; // time in minutes
  private q = new PriorityQueue();

  schedule(dt: number, action: () => void) {
    this.q.push({ t: this.now + dt, action });
  }

  scheduleAt(time: number, action: () => void) {
    this.q.push({ t: time, action });
  }

  async step() {
    if (this.q.length === 0) return false;
    const e = this.q.shift()!;
    this.now = e.t;
    e.action();
    return true;
  }

  reset() {
    this.now = 0;
    this.q = new PriorityQueue();
  }
}

/***********************
 * Seeded RNG + dists
 ***********************/
class RNG {
  private state: number;
  constructor(seed = 42) {
    this.state = seed >>> 0;
  }
  // LCG (glibc-ish)
  next() {
    this.state = (1103515245 * this.state + 12345) >>> 0;
    return (this.state & 0x7fffffff) / 0x80000000;
  }
  expovariate(mean: number) {
    const u = Math.max(1e-12, this.next());
    return -Math.log(u) * mean;
  }
  triangular(low: number, mode: number, high: number) {
    const u = this.next();
    const c = (mode - low) / (high - low);
    if (u < c) return low + Math.sqrt(u * (high - low) * (mode - low));
    return high - Math.sqrt((1 - u) * (high - low) * (high - mode));
  }
}

/***********************
 * Resources & Stores
 ***********************/
export class Resource {
  private capacity: number;
  private inUse = 0;
  private queue: Array<() => void> = [];
  // private name: string;
  constructor(capacity: number) {
    this.capacity = capacity;
    // this.name = name;
  }

  acquire(callback: () => void) {
    if (this.inUse < this.capacity) {
      this.inUse++;
      // console.log(`${this.name} acquired`);
      // console.log(`${this.name} in use: ${this.inUse} of ${this.capacity}`);
      callback();
    } else {
      this.queue.push(callback);
    }
  }

  getStatus() {
    return {
      capacity: this.capacity,
      inUse: this.inUse,
      queueLength: this.queue.length,
      utilization: this.inUse / this.capacity,
    };
  }

  release() {
    this.inUse = Math.max(0, this.inUse - 1);
    if (this.queue.length > 0) {
      const k = this.queue.shift()!;
      this.inUse++;
      k();
    }
  }
}

export class Store<T> {
  private capacity: number;
  private items: T[] = [];
  private getQ: Array<(x: T) => void> = [];
  private putQ: Array<{ item: T; callback: () => void }> = [];

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  put(item: T, callback: () => void) {
    if (this.getQ.length > 0) {
      // Someone is waiting, hand directly to them
      const g = this.getQ.shift()!;
      g(item);
      callback();
      return;
    }
    if (this.items.length < this.capacity) {
      // Space available, store in buffer
      this.items.push(item);
      callback();
      return;
    }
    // Buffer full, queue the put
    this.putQ.push({ item, callback });
  }

  get(callback: (item: T) => void) {
    if (this.items.length > 0) {
      const it = this.items.shift()!;
      if (this.putQ.length > 0) {
        const { item, callback: putCallback } = this.putQ.shift()!;
        if (this.getQ.length > 0) {
          const g = this.getQ.shift()!;
          g(item);
        } else {
          this.items.push(item);
        }
        putCallback();
      }
      callback(it);
    } else {
      this.getQ.push(callback);
    }
  }

  getStatus() {
    return {
      capacity: this.capacity,
      items: this.items.length,
      getQueue: this.getQ.length,
      putQueue: this.putQ.length,
      utilization: this.items.length / this.capacity,
    };
  }
}

/***********************
 * Model parameters
 ***********************/
const MIN = 1;
const HOUR = 60;

export interface SimParams {
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

export const defaultParams: SimParams = {
  randomSeed: 42,
  simHours: 1, // TODO: Update to 4 hours for production
  arrivalMean: 1.8 * MIN,
  cutTime: 1.2 * MIN,
  cellTime: 2.5 * MIN,
  packTime: 1.0 * MIN,
  cutTimeVarLow: 0.8,
  cutTimeVarHigh: 1.2,
  cellTimeVarLow: 0.8,
  cellTimeVarHigh: 1.2,
  packTimeVarLow: 0.8,
  packTimeVarHigh: 1.3,
  cutterCapacity: 1,
  robotCapacity: 1,
  heaterCapacity: 1,
  packerCapacity: 1,
  buf12Cap: 5,
  buf23Cap: 5,
  stepDelayMs: 250,
  failMTBF: 90 * MIN,
  failMTTR: 6 * MIN,
};

/***********************
 * Metrics
 ***********************/
class Metrics {
  completed = 0;
  private enterTimes = new Map<number, number>();
  cycleTimes: number[] = [];
  private wip = 0;
  private lastChange = 0;
  private accum = 0;

  constructor(private env: Env) {}

  startItem(id: number) {
    this.bumpAccum();
    this.wip++;
    this.enterTimes.set(id, this.env.now);
  }

  finishItem(id: number) {
    this.bumpAccum();
    this.wip = Math.max(0, this.wip - 1);
    const t0 = this.enterTimes.get(id);
    if (t0 !== undefined) {
      this.cycleTimes.push(this.env.now - t0);
      this.enterTimes.delete(id);
    }
    this.completed++;
  }

  finalize(simTime: number) {
    this.accum += this.wip * (simTime - this.lastChange);
  }

  avgWIP(simTime: number) {
    return this.accum / simTime;
  }

  getStatus() {
    return {
      completed: this.completed,
      wip: this.wip,
      avgCycleTime: this.cycleTimes.length
        ? this.cycleTimes.reduce((a, b) => a + b, 0) / this.cycleTimes.length
        : 0,
    };
  }

  private bumpAccum() {
    this.accum += this.wip * (this.env.now - this.lastChange);
    this.lastChange = this.env.now;
  }

  reset() {
    this.completed = 0;
    this.enterTimes.clear();
    this.cycleTimes = [];
    this.wip = 0;
    this.lastChange = 0;
    this.accum = 0;
  }
}

/***********************
 * Line definition
 ***********************/
class Line {
  cutter: Resource;
  robot: Resource;
  heater: Resource;
  packer: Resource;
  buf12: Store<number>;
  buf23: Store<number>;

  robotFailuresEnabled = true;
  private nextItemId = 1;

  // Robot failure tracking
  private isRobotFailed = false;
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private estimatedNextFailureTime: number | null = null;

  constructor(
    private env: Env,
    private rng: RNG,
    private m: Metrics,
    private params: SimParams
  ) {
    this.cutter = new Resource(params.cutterCapacity);
    this.robot = new Resource(params.robotCapacity);
    this.heater = new Resource(params.heaterCapacity);
    this.packer = new Resource(params.packerCapacity);
    this.buf12 = new Store<number>(params.buf12Cap);
    this.buf23 = new Store<number>(params.buf23Cap);
  }

  startSource() {
    this.scheduleNextArrival();
    // Start the processing loops for steps 2 and 3
    this.cellProcessingLoop();
    this.packingLoop();
  }

  private scheduleNextArrival() {
    const ia = this.rng.expovariate(this.params.arrivalMean);
    this.env.schedule(ia, () => {
      const id = this.nextItemId++;
      this.m.startItem(id);
      this.startItemFlow(id);
      this.scheduleNextArrival();
    });
  }

  private startItemFlow(itemId: number) {
    this.cutter.acquire(() => {
      const cutTime = this.rng.triangular(
        this.params.cutTimeVarLow * this.params.cutTime,
        this.params.cutTime,
        this.params.cutTimeVarHigh * this.params.cutTime
      );
      this.env.schedule(cutTime, () => {
        // When we try to put, this will block until buffer has space
        // because the callback doesn't run until put succeeds
        this.buf12.put(itemId, () => {
          // Callback runs when item is successfully placed
          this.cutter.release();
        });
      });
    });
  }

  private cellProcessingLoop() {
    this.buf12.get((part) => {
      this.processCell(part, () => {
        // After processing completes, continue the loop
        this.cellProcessingLoop();
      });
    });
  }

  private processCell(part: number, onComplete: () => void) {
    this.robot.acquire(() => {
      this.heater.acquire(() => {
        const cellTime = this.rng.triangular(
          this.params.cellTimeVarLow * this.params.cellTime,
          this.params.cellTime,
          this.params.cellTimeVarHigh * this.params.cellTime
        );
        this.env.schedule(cellTime, () => {
          this.buf23.put(part, () => {
            // Item successfully put in buffer
            this.heater.release();
            this.robot.release();
            onComplete();
          });
        });
      });
    });
  }

  private packingLoop() {
    this.buf23.get((part2) => {
      this.processPackaging(part2, () => {
        // After processing, continue the loop
        this.packingLoop();
      });
    });
  }

  private processPackaging(part2: number, onComplete: () => void) {
    this.packer.acquire(() => {
      const packTime = this.rng.triangular(
        this.params.packTimeVarLow * this.params.packTime,
        this.params.packTime,
        this.params.packTimeVarHigh * this.params.packTime
      );
      this.env.schedule(packTime, () => {
        this.packer.release();
        this.m.finishItem(part2);
        onComplete();
      });
    });
  }

  startRobotFailures() {
    if (!this.robotFailuresEnabled) return;
    this.scheduleNextFailure();
  }

  private scheduleNextFailure() {
    const up = this.rng.expovariate(this.params.failMTBF);
    this.estimatedNextFailureTime = this.env.now + up;

    this.env.schedule(up, () => {
      // Mark robot as failed
      this.isRobotFailed = true;
      this.failureCount++;
      this.lastFailureTime = this.env.now;

      this.robot.acquire(() => {
        const mttr = this.rng.expovariate(this.params.failMTTR);
        this.env.schedule(mttr, () => {
          // Repair complete
          this.isRobotFailed = false;
          this.robot.release();
          this.scheduleNextFailure();
        });
      });
    });
  }

  getStatus() {
    return {
      cutter: this.cutter.getStatus(),
      robot: {
        ...this.robot.getStatus(),
        isFailed: this.isRobotFailed,
        failureCount: this.failureCount,
        lastFailureTime: this.lastFailureTime,
        estimatedNextFailureTime: this.estimatedNextFailureTime,
      },
      heater: this.heater.getStatus(),
      packer: this.packer.getStatus(),
      buf12: this.buf12.getStatus(),
      buf23: this.buf23.getStatus(),
    };
  }

  reset() {
    this.nextItemId = 1;
    this.cutter = new Resource(this.params.cutterCapacity);
    this.robot = new Resource(this.params.robotCapacity);
    this.heater = new Resource(this.params.heaterCapacity);
    this.packer = new Resource(this.params.packerCapacity);
    this.buf12 = new Store<number>(this.params.buf12Cap);
    this.buf23 = new Store<number>(this.params.buf23Cap);

    // Reset failure tracking
    this.isRobotFailed = false;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.estimatedNextFailureTime = null;
  }
}

/***********************
 * Factory Simulation Controller
 ***********************/
export interface SimState {
  time: number;
  isRunning: boolean;
  resources: ReturnType<Line["getStatus"]>;
  metrics: ReturnType<Metrics["getStatus"]>;
}

export class FactorySimulation extends EventEmitter {
  private env: Env;
  private rng: RNG;
  private metrics: Metrics;
  private line: Line;
  private params: SimParams;
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private dbClient: TimescaleDBClient | null = null;
  private writeToFoundation: boolean = false;

  constructor(params: SimParams = defaultParams) {
    super();
    this.params = { ...params };
    this.env = new Env();
    this.rng = new RNG(this.params.randomSeed);
    this.metrics = new Metrics(this.env);
    this.line = new Line(this.env, this.rng, this.metrics, this.params);

    // Check environment variable for foundation writing mode
    const writeMode = process.env.WRITE_TO_FOUNDATION_ENV;

    // Initialize database client based on mode
    if (writeMode === "local" || writeMode === "stage") {
      this.initializeDatabaseClient(writeMode);
    } else {
      console.log(
        "Database writes disabled (WRITE_TO_FOUNDATION_ENV not set or set to 'false')"
      );
    }
  }

  private async initializeDatabaseClient(
    mode: "local" | "stage"
  ): Promise<void> {
    try {
      let dbConfig: TimescaleDBConfig;

      if (mode === "local") {
        // Dynamically import local config
        const { localDbConfig } = await import("./config/db.local.js");
        dbConfig = localDbConfig;
      } else {
        // Dynamically import stage config
        const { stageDbConfig } = await import("./config/db.stage.js");
        dbConfig = stageDbConfig;
      }

      this.dbClient = new TimescaleDBClient(dbConfig);
      await this.dbClient.connect();
      this.writeToFoundation = true;
      console.log(
        `Connected to TimescaleDB (${mode} mode) - database writes enabled`
      );
    } catch (error) {
      console.error(
        `Failed to initialize database connection (${mode} mode):`,
        error
      );
      console.log(
        "Continuing without database writes. Make sure config file exists at server/config/db." +
          mode +
          ".ts"
      );
      this.writeToFoundation = false;
    }
  }

  updateParams(newParams: Partial<SimParams>) {
    this.params = { ...this.params, ...newParams };
    // Always reset to apply new parameters (recreate resources/buffers with new capacities)
    const wasRunning = this.isRunning;
    if (wasRunning) {
      this.stop();
    }
    this.reset();
  }

  getParams(): SimParams {
    return { ...this.params };
  }

  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.line.startSource();
    this.line.startRobotFailures();

    this.intervalId = setInterval(async () => {
      const simTime = this.params.simHours * HOUR;
      if (this.env.now >= simTime) {
        this.stop();
        this.metrics.finalize(simTime);
        this.emit("complete", this.getState());
        return;
      }

      await this.env.step();
      await this.pushTelemetryToFoundation();
      this.emit("state", this.getState());
    }, this.params.stepDelayMs);
  }

  stop() {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  reset() {
    this.stop();
    this.env.reset();
    this.rng = new RNG(this.params.randomSeed);
    this.metrics.reset();
    this.line = new Line(this.env, this.rng, this.metrics, this.params);
    this.emit("reset", this.getState());
  }

  getState(): SimState {
    return {
      time: this.env.now,
      isRunning: this.isRunning,
      resources: this.line.getStatus(),
      metrics: this.metrics.getStatus(),
    };
  }

  private async pushTelemetryToFoundation() {
    const telemetry = this.getState();

    const queueLength = telemetry.resources.cutter.queueLength;
    const cutterHealth = 0;
    const cutterWIP = telemetry.resources.cutter.inUse;
    const buffer12Level = telemetry.resources.buf12.items;
    const robotHealth = telemetry.resources.robot.isFailed ? 1 : 0;
    const robotWIP = telemetry.resources.robot.inUse;
    const heaterHealth = 0;
    const heaterWIP = telemetry.resources.heater.inUse;
    const buffer23Level = telemetry.resources.buf23.items;
    const packerHealth = 0;
    const packerWIP = telemetry.resources.packer.inUse;
    const finishedGoods = telemetry.metrics.completed;

    const timestamp = Date.now();

    const payload: TelemetryData = {
      timestamp,
      queueLength,
      cutterHealth,
      cutterWIP,
      robotHealth,
      robotWIP,
      heaterHealth,
      heaterWIP,
      buffer12Level,
      buffer23Level,
      packerHealth,
      packerWIP,
      finishedGoods,
    };

    // console.log(payload);

    // Write to TimescaleDB if enabled
    if (this.writeToFoundation && this.dbClient) {
      try {
        await this.dbClient.writeTelemetry(payload);
      } catch (error) {
        console.error("Failed to write telemetry to database:", error);
      }
    }
  }
}
