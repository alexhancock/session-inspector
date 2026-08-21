import { Fact } from './model'

/** A decoded session file: `data` is the parsed JSON value, or an array of JSONL records. */
export interface SessionFile {
  readonly name: string
  readonly data: unknown
}

/** What one model request cost. `input` excludes cache; `reasoning` is part of `output`. */
export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  costUsd: number
}

interface Occurred {
  /** When this finished, in epoch milliseconds. */
  at: number
  /** The original record, shown verbatim in the step detail. */
  raw?: unknown
}

/** Something a person typed. Time spent waiting for one is reported as idle. */
export interface Prompt extends Occurred {
  type: 'prompt'
  text: string
}

/** One model response, or the part of one that arrived before a tool ran. */
export interface Response extends Occurred {
  type: 'response'
  blocks: ResponseBlock[]
  /** Blocks of one request may arrive as several responses; share an id to bill them once. */
  requestId?: string
  /** Repeat the request's usage on each of its responses. */
  usage?: Usage
  /** When generating began, if the harness records it; otherwise the previous event's end. */
  startedAt?: number
  model?: string
  /** The work of a subagent rather than the main loop. */
  sidechain?: boolean
}

/** A block within a response. `at` is when it finished, if the harness records that. */
export type ResponseBlock =
  | { type: 'thinking'; text: string; at?: number; raw?: unknown }
  | { type: 'message'; text: string; at?: number; raw?: unknown }
  | { type: 'call'; id: string; name: string; args: unknown; at?: number; raw?: unknown }

/** What a tool returned, matched to its call by id. */
export interface Result extends Occurred {
  type: 'result'
  callId: string
  text: string
  failed: boolean
}

/** Anything else on the record: injected context, attachments, harness events. */
export interface Note extends Occurred {
  type: 'note'
  label: string
  /** Rendered as labelled fields: pass a string for one field, an object for one per key. */
  detail: unknown
  /** What entered the model's context, if any. Charged as input tokens. */
  context?: string
  preview?: string
}

export type SessionEvent = Prompt | Response | Result | Note

/** What the interface shows about the session as a whole. */
export interface Summary {
  id: string
  title: string
  model: string
  cwd: string
  startedAt: number
  endedAt: number
  facts: Fact[]
}

/**
 * One agent's session format. Implement these three methods and the shared builder
 * reconstructs timings, token attribution, and idle gaps for you.
 */
export interface Harness {
  /** How this agent is named in the interface. */
  readonly agent: string
  /** Whether this file is one of ours. */
  recognizes(file: SessionFile): boolean
  /** The session as a whole. */
  summarize(file: SessionFile): Summary
  /** Everything that happened, oldest first. */
  timeline(file: SessionFile): SessionEvent[]
}
