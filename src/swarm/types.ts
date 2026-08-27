/** Live events describing what the agent swarm is doing, for the 3D viewer. */

export type AgentStatus = 'spawning' | 'thinking' | 'working' | 'blocked' | 'done' | 'error';

export type SwarmEvent =
  /** A worker joined the office. `role` groups similar agents (explorer, coder…). */
  | { type: 'agent_spawned'; id: string; label: string; role: string; parent?: string; t: number }
  /** Status change — drives the avatar's animation/pose. */
  | { type: 'agent_status'; id: string; status: AgentStatus; detail?: string; t: number }
  /** A tool call starting or finishing. */
  | { type: 'agent_tool'; id: string; tool: string; summary: string; phase: 'start' | 'end'; ok?: boolean; t: number }
  /** A short line the worker "says" — rendered as a speech bubble. */
  | { type: 'agent_message'; id: string; text: string; t: number }
  /** Communication between two workers (shared finding / hand-off). Draws a link. */
  | { type: 'communication'; from: string; to: string | 'all'; text?: string; t: number }
  /** A note posted to the shared blackboard (hive memory). */
  | { type: 'blackboard'; id: string; note: string; t: number }
  /** A worker left. */
  | { type: 'agent_done'; id: string; status: 'done' | 'error'; t: number };

export interface SwarmSnapshot {
  startedAt: number;
  events: SwarmEvent[];
  blackboard: Array<{ id: string; note: string; t: number }>;
}
