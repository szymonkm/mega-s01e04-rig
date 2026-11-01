export type RunStatus = 'ok' | 'retry' | 'fail'

export interface DigestRow {
  job: string
  /** Owner on the latest event, including an explicit null. */
  owner: string | null
  /** Total valid events for this job. */
  runs: number
  /** Valid events whose status is retry. */
  retries: number
  lastStatus: RunStatus
  /** Latest recorded error, retained after later events without an error. */
  lastError: string | null
  /** Original timestamps, with their logged offsets preserved. */
  firstAt: string
  lastAt: string
}

export interface NightDigest {
  night: string
  /** One row per job, sorted by job name. */
  rows: DigestRow[]
  badLines: number
  /** Counts of valid events, rather than final job statuses. */
  counts: Record<RunStatus, number>
}

/** Returns null for an invalid night or a missing log file. */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null
