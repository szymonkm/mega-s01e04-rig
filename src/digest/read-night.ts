import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

type JobState = {
  row: DigestRow;
  firstTime: number;
  lastTime: number;
  lastErrorTime: number | null;
};

function isNight(night: string): boolean {
  if (night.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return false;
  const time = Date.parse(`${night}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === night;
}

// Require a real date and an explicit time zone. Keep the original string for display.
function isTimestamp(at: unknown): at is string {
  if (typeof at !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(at);
  return match !== null
    && match[0].length === at.length
    && isNight(match[1])
    && Number(match[2]) < 24
    && Number(match[3]) < 60
    && Number(match[4]) < 60
    && (match[5] === undefined || (Number(match[6]) < 24 && Number(match[7]) < 60))
    && Number.isFinite(Date.parse(at));
}

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!('at' in value) || !isTimestamp(value.at)) return null;
  if (!('job' in value) || typeof value.job !== 'string' || value.job.trim() === '') return null;
  if (!('status' in value) || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')) return null;
  if (!('owner' in value) || (value.owner !== null && typeof value.owner !== 'string')) return null;
  const error = 'error' in value ? value.error : undefined;
  if (error !== undefined && typeof error !== 'string') return null;

  return {
    at: value.at,
    job: value.job,
    status: value.status,
    owner: value.owner,
    ...(error === undefined ? {} : { error }),
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isNight(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return null;
    }
    throw error;
  }

  const digest: NightDigest = { night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, JobState>();
  const lines = contents.split(/\r?\n/);
  // A final newline is a terminator, not an extra record. Other blank lines are invalid records.
  if (lines.at(-1) === '') lines.pop();

  for (const line of lines) {
    const event = parseEvent(line);
    if (event === null) {
      digest.badLines += 1;
      continue;
    }

    digest.counts[event.status] += 1;
    const time = Date.parse(event.at);
    const state = jobs.get(event.job);
    if (state === undefined) {
      jobs.set(event.job, {
        row: {
          job: event.job,
          owner: event.owner,
          runs: 1,
          retries: event.status === 'retry' ? 1 : 0,
          lastStatus: event.status,
          lastError: event.error ?? null,
          firstAt: event.at,
          lastAt: event.at,
        },
        firstTime: time,
        lastTime: time,
        lastErrorTime: event.error === undefined ? null : time,
      });
      continue;
    }

    state.row.runs += 1;
    if (event.status === 'retry') state.row.retries += 1;
    if (time < state.firstTime) {
      state.firstTime = time;
      state.row.firstAt = event.at;
    }
    // Compare actual times across offsets. The later line wins when times are equal.
    if (time >= state.lastTime) {
      state.lastTime = time;
      state.row.lastAt = event.at;
      state.row.lastStatus = event.status;
      state.row.owner = event.owner;
    }
    // Keep the latest recorded error even if the job later succeeds without an error.
    if (event.error !== undefined && (state.lastErrorTime === null || time >= state.lastErrorTime)) {
      state.lastErrorTime = time;
      state.row.lastError = event.error;
    }
  }

  digest.rows = [...jobs.values()].map(({ row }) => row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
