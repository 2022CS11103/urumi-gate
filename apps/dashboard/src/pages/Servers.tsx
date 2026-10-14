import { FormEvent, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Badge, Banner, Button, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from "@/components/ui";
import { api, type McpServer, type SessionUser } from "@/lib/api";
import { formatWhen } from "@/lib/utils";

interface Draft {
  name: string;
  slug: string;
  url: string;
  authType: "none" | "bearer" | "header";
  authHeaderName: string;
  credential: string;
  allowPrivate: boolean;
  writeMinRole: "admin" | "member";
  enabled: boolean;
}

const emptyDraft: Draft = {
  name: "",
  slug: "",
  url: "",
  authType: "bearer",
  authHeaderName: "",
  credential: "",
  allowPrivate: false,
  writeMinRole: "admin",
  enabled: true,
};

function statusTone(status: McpServer["status"]): "ok" | "warn" | "neutral" {
  if (status === "connected") return "ok";
  if (status === "unreachable") return "warn";
  return "neutral";
}

function statusLabel(status: McpServer["status"]): string {
  if (status === "connected") return "Connected";
  if (status === "unreachable") return "Unreachable";
  return "Disabled";
}

export function ServersPage() {
  const user = useOutletContext<SessionUser>();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    try {
      const body = await api.servers();
      setServers(body.servers);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load servers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(timer);
  }, []);

  function startCreate() {
    setEditing(null);
    setDraft(emptyDraft);
    setFormError("");
    setOpen(true);
  }

  function startEdit(server: McpServer) {
    setEditing(server);
    setDraft({
      name: server.name,
      slug: server.slug,
      url: server.url ?? "",
      authType: server.authType ?? "none",
      authHeaderName: server.authHeaderName ?? "",
      credential: "",
      allowPrivate: Boolean(server.allowPrivate),
      writeMinRole: server.writeMinRole,
      enabled: server.enabled,
    });
    setFormError("");
    setOpen(true);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setFormError("");
    const body: Record<string, unknown> = {
      name: draft.name,
      slug: draft.slug,
      url: draft.url,
      authType: draft.authType,
      authHeaderName: draft.authType === "header" ? draft.authHeaderName : undefined,
      allowPrivate: draft.allowPrivate,
      writeMinRole: draft.writeMinRole,
      enabled: draft.enabled,
    };
    if (draft.credential) body.credential = draft.credential;
    try {
      if (editing) await api.updateServer(editing.id, body);
      else await api.createServer(body);
      setOpen(false);
      await load();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Could not save the server");
    } finally {
      setPending(false);
    }
  }

  async function toggle(server: McpServer) {
    setError("");
    try {
      await api.updateServer(server.id, { enabled: !server.enabled });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the server");
    }
  }

  async function remove(server: McpServer) {
    const warning = server.builtin
      ? "This platform server is restored the next time the gateway starts. Disable it if you want it to stay off."
      : "Remove this upstream from the gateway?";
    if (!window.confirm(warning)) return;
    try {
      await api.deleteServer(server.id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove the server");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl tracking-tight">MCP servers</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Tool names are prefixed with the server slug, so two upstreams can both expose <span className="font-mono">list_orders</span> without colliding.
          </p>
        </div>
        {user.role === "admin" ? <Button onClick={startCreate}>Add server</Button> : null}
      </div>
      {error ? <div className="mt-4"><Banner tone="bad">{error}</Banner></div> : null}
      {loading ? <p className="mt-8 text-sm text-ink-soft">Checking upstreams…</p> : null}
      {!loading && servers.length === 0 ? (
        <p className="mt-8 rounded-md border border-dashed border-line px-4 py-8 text-sm text-ink-soft">No MCP servers registered yet.</p>
      ) : null}
      <div className="mt-6 divide-y divide-line border-y border-line">
        {servers.map((server) => (
          <article key={server.id} className="py-4">
            <div className="flex flex-wrap items-start gap-3">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setExpanded(expanded === server.id ? null : server.id)}>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-medium">{server.name}</h2>
                  <Badge tone={statusTone(server.status)}>{statusLabel(server.status)}</Badge>
                  {server.builtin ? <Badge>Platform</Badge> : null}
                  <span className="font-mono text-xs text-ink-soft">{server.slug}</span>
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {server.tools.filter((tool) => tool.allowed).length} tools visible to you
                  {server.latencyMs !== null && server.status === "connected" ? ` · ${server.latencyMs} ms` : ""}
                  {server.lastCheckedAt ? ` · checked ${formatWhen(server.lastCheckedAt)}` : ""}
                </p>
              </button>
              {user.role === "admin" ? (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => toggle(server)}>
                    {server.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => startEdit(server)}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(server)}>Remove</Button>
                </div>
              ) : null}
            </div>
            {server.lastError && server.status === "unreachable" ? (
              <p className="mt-2 text-sm text-warn">{server.lastError}</p>
            ) : null}
            {user.role === "admin" && server.url ? <p className="mt-1 break-all font-mono text-xs text-ink-soft">{server.url}</p> : null}
            {expanded === server.id ? (
              <ul className="mt-3 space-y-2">
                {server.tools.length === 0 ? <li className="text-sm text-ink-soft">No tools recorded from the last probe.</li> : null}
                {server.tools.map((tool) => (
                  <li key={tool.name} className="rounded-md border border-line bg-paper-2 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 break-all font-mono text-sm">{tool.name}</span>
                      {tool.write ? <Badge tone="seal">Write</Badge> : <Badge>Read</Badge>}
                      {!tool.allowed ? <Badge tone="neutral">Hidden from you</Badge> : null}
                      {tool.suspicious ? <Badge tone="bad">Suspicious description</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm text-ink-soft">{tool.description || "No description."}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{editing ? "Edit server" : "Add server"}</DialogTitle>
          <DialogDescription>
            The credential stays on the gateway. It is encrypted at rest and never returned to the browser.
          </DialogDescription>
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            {formError ? <Banner tone="bad">{formError}</Banner> : null}
            <Field label="Name">
              <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
            </Field>
            <Field label="Slug">
              <Input
                value={draft.slug}
                onChange={(event) => setDraft({ ...draft, slug: event.target.value.toLowerCase() })}
                pattern="[a-z][a-z0-9_]{0,31}"
                required
              />
            </Field>
            <Field label="Streamable HTTP URL">
              <Input value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} required />
            </Field>
            <Field label="Auth">
              <select
                className="h-10 w-full rounded-md border border-line bg-paper px-3 text-sm"
                value={draft.authType}
                onChange={(event) => setDraft({ ...draft, authType: event.target.value as Draft["authType"] })}
              >
                <option value="none">None</option>
                <option value="bearer">Bearer token</option>
                <option value="header">Static header</option>
              </select>
            </Field>
            {draft.authType === "header" ? (
              <Field label="Header name">
                <Input value={draft.authHeaderName} onChange={(event) => setDraft({ ...draft, authHeaderName: event.target.value })} required />
              </Field>
            ) : null}
            {draft.authType !== "none" ? (
              <Field label={editing ? "Credential (leave blank to keep)" : "Credential"}>
                <Input
                  type="password"
                  value={draft.credential}
                  onChange={(event) => setDraft({ ...draft, credential: event.target.value })}
                  required={!editing}
                />
              </Field>
            ) : null}
            <Field label="Who can call write tools">
              <select
                className="h-10 w-full rounded-md border border-line bg-paper px-3 text-sm"
                value={draft.writeMinRole}
                onChange={(event) => setDraft({ ...draft, writeMinRole: event.target.value as Draft["writeMinRole"] })}
              >
                <option value="admin">Admins only</option>
                <option value="member">Every member</option>
              </select>
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={draft.allowPrivate}
                onChange={(event) => setDraft({ ...draft, allowPrivate: event.target.checked })}
              />
              <span>Allow a private or cluster address. Metadata endpoints stay blocked either way.</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
              Enabled
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
