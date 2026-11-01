import type { NightDigest } from '../digest/types.js';

export function DigestPage({ digest }: { digest: NightDigest }) {
  return (
    <>
      <h1>digest · {digest.night}</h1>
      <p>
        Events: {digest.counts.ok} ok · {digest.counts.retry} retry · {digest.counts.fail} fail
      </p>
      <p class={digest.badLines > 0 ? 'warn' : 'mute'}>
        Invalid lines: {digest.badLines}
      </p>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Owner</th>
              <th>Runs</th>
              <th>Retries</th>
              <th>Last status</th>
              <th>Last error</th>
              <th>First time</th>
              <th>Last time</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr>
                <td>{row.job}</td>
                <td>{row.owner ?? '—'}</td>
                <td>{row.runs}</td>
                <td class={row.retries >= 3 ? 'warn' : undefined}>{row.retries}</td>
                <td class={row.lastStatus === 'fail' ? 'warn' : undefined}>{row.lastStatus}</td>
                <td>{row.lastError ?? '—'}</td>
                <td>{row.firstAt}</td>
                <td>{row.lastAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
