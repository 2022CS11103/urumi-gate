import { FormEvent, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Badge, Banner, Button, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from "@/components/ui";
import { api, type ApiKey, type Member, type SessionUser } from "@/lib/api";
import { formatWhen } from "@/lib/utils";

export function TeamPage() {
  const user = useOutletContext<SessionUser>();
  const [members, setMembers] = useState<Member[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState({ name: "", email: "", password: "", role: "member" as "admin" | "member" });
  const [keyName, setKeyName] = useState("cursor");
  const [keyUserId, setKeyUserId] = useState("");
  const [secret, setSecret] = useState("");
  const [secretOpen, setSecretOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const keyBody = await api.keys();
      setKeys(keyBody.keys);
      if (user.role === "admin") {
        const team = await api.team();
        setMembers(team.users);
      }
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the team");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [user.role]);

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api.invite(invite);
      setInvite({ name: "", email: "", password: "", role: "member" });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not invite");
    }
  }

  async function onKey(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await api.createKey({ name: keyName, userId: keyUserId || undefined });
      setSecret(created.secret);
      setSecretOpen(true);
      setCopied(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not issue a key");
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this key? The next call with it will be rejected.")) return;
    try {
      await api.revokeKey(id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not revoke the key");
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl tracking-tight">Team and keys</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          Each person gets their own gateway key. Upstream credentials stay on the server, and a revoked key stops working on the next call.
        </p>
      </div>
      {error ? <Banner tone="bad">{error}</Banner> : null}
      {loading ? <p className="text-sm text-ink-soft">Loading access…</p> : null}

      {user.role === "admin" ? (
        <section className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={onInvite} className="space-y-3 rounded-lg border border-line bg-paper-2 p-4">
            <h2 className="font-serif text-xl">Invite</h2>
            <Field label="Name"><Input value={invite.name} onChange={(event) => setInvite({ ...invite, name: event.target.value })} required /></Field>
            <Field label="Email"><Input type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} required /></Field>
            <Field label="Temporary password"><Input type="text" value={invite.password} onChange={(event) => setInvite({ ...invite, password: event.target.value })} minLength={8} required /></Field>
            <Field label="Role">
              <select className="h-10 w-full rounded-md border border-line bg-paper px-3 text-sm" value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value as "admin" | "member" })}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <Button type="submit">Create account</Button>
          </form>
          <ul className="divide-y divide-line rounded-lg border border-line bg-paper-2">
            {members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{member.name}</div>
                  <div className="text-ink-soft">{member.email}</div>
                </div>
                <Badge tone={member.role === "admin" ? "seal" : "neutral"}>{member.role}</Badge>
                {member.disabled ? <Badge tone="bad">Disabled</Badge> : null}
                {member.id !== user.id ? (
                  <Button variant="outline" size="sm" onClick={() => void api.setDisabled(member.id, !member.disabled).then(load)}>
                    {member.disabled ? "Enable" : "Disable"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="font-serif text-xl">API keys</h2>
        <form onSubmit={onKey} className="flex flex-wrap items-end gap-3">
          <Field label="Key name">
            <Input value={keyName} onChange={(event) => setKeyName(event.target.value)} required />
          </Field>
          {user.role === "admin" ? (
            <Field label="Issue for">
              <select className="h-10 rounded-md border border-line bg-paper px-3 text-sm" value={keyUserId} onChange={(event) => setKeyUserId(event.target.value)}>
                <option value="">Myself</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>{member.email}</option>
                ))}
              </select>
            </Field>
          ) : null}
          <Button type="submit">Generate key</Button>
        </form>
        <ul className="divide-y divide-line border-y border-line">
          {keys.length === 0 ? <li className="py-4 text-sm text-ink-soft">No keys yet.</li> : null}
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{key.name}</div>
                <div className="font-mono text-xs text-ink-soft">{key.keyPrefix}… · {key.userEmail} · {formatWhen(key.createdAt)}</div>
              </div>
              {key.revokedAt ? <Badge tone="bad">Revoked {formatWhen(key.revokedAt)}</Badge> : <Badge tone="ok">Active</Badge>}
              {!key.revokedAt ? <Button variant="outline" size="sm" onClick={() => void revoke(key.id)}>Revoke</Button> : null}
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={secretOpen} onOpenChange={setSecretOpen}>
        <DialogContent>
          <DialogTitle>Copy the key now</DialogTitle>
          <DialogDescription>This is the only time the full key is shown. Store it in your MCP client. The gateway keeps a hash.</DialogDescription>
          <pre className="mt-4 overflow-x-auto rounded-md bg-ink px-3 py-3 text-sm text-paper">{secret}</pre>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(secret).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button onClick={() => setSecretOpen(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
