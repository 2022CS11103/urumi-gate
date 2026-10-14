import { useEffect, useState } from "react";
import { Badge, Banner } from "@/components/ui";
import { api, type AuditEntry } from "@/lib/api";
import { formatWhen } from "@/lib/utils";

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    async function load() {
      try {
        const body = await api.audit();
        if (!cancel) {
          setEntries(body.entries);
          setError("");
        }
      } catch (reason) {
        if (!cancel) setError(reason instanceof Error ? reason.message : "Could not load the audit log");
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div>
      <h1 className="font-serif text-3xl tracking-tight">Audit log</h1>
      <p className="mt-1 text-sm text-ink-soft">Every chat and external MCP call, with the user it ran as. Members see only their own rows.</p>
      {error ? <div className="mt-4"><Banner tone="bad">{error}</Banner></div> : null}
      {loading ? <p className="mt-8 text-sm text-ink-soft">Reading the log…</p> : null}
      {!loading && entries.length === 0 ? <p className="mt-8 text-sm text-ink-soft">No tool calls yet.</p> : null}
      <div className="mt-4 hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="py-2 font-medium">When</th>
              <th className="py-2 font-medium">Who</th>
              <th className="py-2 font-medium">Source</th>
              <th className="py-2 font-medium">Server</th>
              <th className="py-2 font-medium">Tool</th>
              <th className="py-2 font-medium">Duration</th>
              <th className="py-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-line align-top">
                <td className="py-2 pr-3 whitespace-nowrap">{formatWhen(entry.startedAt)}</td>
                <td className="py-2 pr-3">{entry.userEmail}</td>
                <td className="py-2 pr-3">{entry.source}</td>
                <td className="py-2 pr-3 font-mono text-xs">{entry.serverSlug}</td>
                <td className="py-2 pr-3 font-mono text-xs">{entry.toolName}</td>
                <td className="py-2 pr-3">{entry.durationMs} ms</td>
                <td className="py-2">
                  <Badge tone={entry.success ? "ok" : "bad"}>{entry.success ? "ok" : "failed"}</Badge>
                  {entry.error ? <p className="mt-1 max-w-xs text-xs text-ink-soft">{entry.error}</p> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-4 space-y-3 md:hidden">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded-md border border-line bg-paper-2 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span>{formatWhen(entry.startedAt)}</span>
              <Badge tone={entry.success ? "ok" : "bad"}>{entry.success ? "ok" : "failed"}</Badge>
            </div>
            <p className="mt-1">{entry.userEmail} · {entry.source}</p>
            <p className="mt-1 font-mono text-xs">{entry.toolName}</p>
            <p className="text-xs text-ink-soft">{entry.serverSlug} · {entry.durationMs} ms</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
