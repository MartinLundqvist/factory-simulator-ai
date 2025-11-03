// timescaleDB.ts - TimescaleDB client for telemetry data
import pkg from "pg";
const { Client } = pkg;
import { TAG_DICTIONARY } from "./TagDictionary.js";

export interface TimescaleDBConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  schema: string;
  table: string;
}

export interface TelemetryData {
  timestamp: number;
  queueLength: number;
  cutterHealth: number;
  cutterWIP: number;
  robotHealth: number;
  robotWIP: number;
  heaterHealth: number;
  heaterWIP: number;
  buffer12Level: number;
  buffer23Level: number;
  packerHealth: number;
  packerWIP: number;
  finishedGoods: number;
}

export class TimescaleDBClient {
  private client: typeof Client.prototype | null = null;
  private config: TimescaleDBConfig;
  private isConnected = false;

  constructor(config: TimescaleDBConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    try {
      this.client = new Client({
        host: this.config.host,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
      });

      await this.client.connect();
      this.isConnected = true;
      console.log("Connected to TimescaleDB");
    } catch (error) {
      console.error("Failed to connect to TimescaleDB:", error);
      throw error;
    }
  }

  async writeTelemetry(data: TelemetryData): Promise<void> {
    if (!this.isConnected || !this.client) {
      throw new Error("Database not connected");
    }

    const query = `
      INSERT INTO ${this.config.schema}.${this.config.table} (
        timeseries_id,
        timestamp,
        value
      ) VALUES ($1, to_timestamp($2 / 1000.0), $3)
    `;

    try {
      // Write one row per telemetry field
      for (const [key, value] of Object.entries(data)) {
        if (key === "timestamp") continue; // Skip timestamp field itself

        const timeseriesId = TAG_DICTIONARY[key as keyof typeof TAG_DICTIONARY];
        if (!timeseriesId) {
          console.warn(`No timeseries_id found for key: ${key}`);
          continue;
        }

        await this.client.query(query, [timeseriesId, data.timestamp, value]);
      }
    } catch (error) {
      console.error("Failed to write telemetry to TimescaleDB:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected && this.client) {
      await this.client.end();
      this.isConnected = false;
      console.log("Disconnected from TimescaleDB");
    }
  }
}
