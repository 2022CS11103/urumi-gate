import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Banner, Button, Input } from "@/components/ui";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api.login(email, password);
      navigate("/servers");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-16">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-seal">Team MCP gateway</p>
      <h1 className="mt-2 font-serif text-4xl tracking-tight">Sign in to the gate</h1>
      <p className="mt-3 text-sm leading-6 text-ink-soft">
        An admin connects each upstream once. Everyone else uses those tools from this chat, or from Cursor, without
        ever seeing the store credentials.
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        {error ? <Banner tone="bad">{error}</Banner> : null}
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">Email</span>
          <Input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">Password</span>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Checking…" : "Enter"}
        </Button>
      </form>
    </div>
  );
}
