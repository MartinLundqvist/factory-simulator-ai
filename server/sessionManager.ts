import { FactorySimulation } from "./FactorySimulation.js";
import type { SimParams } from "./FactorySimulation.js";
import type { Response } from "express";

interface SessionData {
  simulation: FactorySimulation;
  clients: Set<Response>;
  lastActivity: number;
}

export class SessionManager {
  private sessions: Map<string, SessionData> = new Map();
  private cleanupIntervalId: NodeJS.Timeout | null = null;
  private readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.startCleanupInterval();
  }

  /**
   * Get or create a session
   */
  getOrCreateSession(sessionId: string, defaultParams: SimParams): SessionData {
    if (!this.sessions.has(sessionId)) {
      console.log(`Creating new session: ${sessionId}`);
      const simulation = new FactorySimulation(defaultParams);
      this.sessions.set(sessionId, {
        simulation,
        clients: new Set(),
        lastActivity: Date.now(),
      });
    } else {
      // Update last activity timestamp
      const session = this.sessions.get(sessionId)!;
      session.lastActivity = Date.now();
    }
    return this.sessions.get(sessionId)!;
  }

  /**
   * Get a session if it exists
   */
  getSession(sessionId: string): SessionData | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
    }
    return session;
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    const sessionData = this.sessions.get(sessionId);
    if (sessionData) {
      console.log(`Deleting session: ${sessionId}`);
      // Stop the simulation
      sessionData.simulation.stop();
      // Close all SSE connections
      sessionData.clients.forEach((client) => {
        client.end();
      });
      this.sessions.delete(sessionId);
      return true;
    }
    return false;
  }

  /**
   * Add a client to a session
   */
  addClient(sessionId: string, client: Response): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.clients.add(client);
      session.lastActivity = Date.now();
      console.log(`Client added to session ${sessionId}. Total clients: ${session.clients.size}`);
    }
  }

  /**
   * Remove a client from a session
   */
  removeClient(sessionId: string, client: Response): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.clients.delete(client);
      console.log(`Client removed from session ${sessionId}. Total clients: ${session.clients.size}`);
    }
  }

  /**
   * Get all session IDs
   */
  getAllSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Start the cleanup interval to remove inactive sessions
   */
  private startCleanupInterval(): void {
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupInactiveSessions();
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Clean up sessions that have been inactive for too long
   */
  private cleanupInactiveSessions(): void {
    const now = Date.now();
    const sessionsToDelete: string[] = [];

    this.sessions.forEach((session, sessionId) => {
      const inactiveTime = now - session.lastActivity;
      if (inactiveTime > this.SESSION_TIMEOUT_MS) {
        sessionsToDelete.push(sessionId);
      }
    });

    sessionsToDelete.forEach((sessionId) => {
      console.log(`Session ${sessionId} timed out after ${this.SESSION_TIMEOUT_MS / 1000}s of inactivity`);
      this.deleteSession(sessionId);
    });

    if (sessionsToDelete.length > 0) {
      console.log(`Cleaned up ${sessionsToDelete.length} inactive session(s). Active sessions: ${this.sessions.size}`);
    }
  }

  /**
   * Stop the cleanup interval
   */
  stopCleanup(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  /**
   * Clean up all sessions and stop cleanup interval
   */
  shutdown(): void {
    console.log("Shutting down SessionManager...");
    this.stopCleanup();
    this.sessions.forEach((_sessionData, sessionId) => {
      this.deleteSession(sessionId);
    });
    console.log("SessionManager shutdown complete");
  }
}
