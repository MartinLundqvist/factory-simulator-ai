// Example database configuration
// Copy this file to db.local.ts or db.stage.ts and update with your actual credentials
import { TimescaleDBConfig } from "../timescaleDB.js";

export const exampleDbConfig: TimescaleDBConfig = {
  host: "your-database-host",
  port: 5432,
  user: "your-username",
  password: "your-password",
  database: "your-database-name",
  schema: "public",
  table: "timeseries_data_numeric_processed",
};
