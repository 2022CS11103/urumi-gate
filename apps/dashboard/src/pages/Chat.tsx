import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { Badge, Banner, Button, Textarea } from "@/components/ui";
import { api, type ChatMessage, type ChatThread, type SessionUser } from "@/lib/api";
import { cn } from "@/lib/utils";

const suggestions = [
  "Create a product named Harbor Mug for 18 dollars",
  "What orders came in today?",
  "What orders came in today, and what is our shipping promise?",
  "Convert 18 USD to EUR",
];

export function ChatPage() {
  const user = useOutletContext<SessionUser>();
  const { threadId } = useParams();
  const navigate = useNavigate();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api.threads().then((body) => setThreads(body.threads)).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not load conversations");
    });
  }, [threadId]);

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }
    api.thread(threadId).then((body) => setMessages(body.messages)).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not load the conversation");
    });
  }, [threadId]);

  async function send(text: string) {
    const message = text.trim();
    if (!message) return;
    setPending(true);
    setError("");
    setDraft("");
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: message,
      trace: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    try {
      const result = await api.chat({ message, threadId });
      setMessages((current) => [...current.filter((item) => item.id !== optimistic.id), optimistic, result.message]);
      if (!threadId) navigate(`/chat/${result.threadId}`);
      const listed = await api.threads();
      setThreads(listed.threads);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The assistant failed");
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <aside>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="font-serif text-2xl">Chat</h1>
          <Button variant="outline" size="sm" onClick={() => navigate("/chat")}>New</Button>
        </div>
        <p className="mb-3 text-xs text-ink-soft">
          {user.llm.mode === "model" ? `Model ${user.llm.model}` : "Offline planner"} · calls are audited as {user.name}
        </p>
        <ul className="space-y-1">
          {threads.length === 0 ? <li className="text-sm text-ink-soft">No conversations yet.</li> : null}
          {threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => navigate(`/chat/${thread.id}`)}
                className={cn(
                  "w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-paper-2",
                  thread.id === threadId && "bg-seal-soft text-seal",
                )}
              >
                {thread.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="flex min-h-[70vh] flex-col rounded-lg border border-line bg-paper-2">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div>
              <p className="text-sm text-ink-soft">Ask about products, today’s orders, shipping, or a currency conversion.</p>
              <div className="mt-3 flex flex-col gap-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="rounded-md border border-line bg-paper px-3 py-2 text-left text-sm hover:border-seal"
                    onClick={() => void send(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((message) => (
            <article key={message.id}>
              <p className="text-xs uppercase tracking-wide text-ink-soft">{message.role === "user" ? user.name : "Gate"}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{message.content}</p>
              {message.trace && message.trace.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {message.trace.map((trace, index) => (
                    <li key={`${trace.tool}-${index}`} className="rounded-md border border-line bg-paper px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono">{trace.tool}</span>
                        <Badge tone={trace.ok ? "ok" : "bad"}>{trace.ok ? "ok" : "failed"}</Badge>
                        <span className="text-ink-soft">{trace.durationMs} ms</span>
                      </div>
                      <pre className="mt-1 whitespace-pre-wrap font-sans text-ink-soft">{trace.preview}</pre>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
          {pending ? <p className="text-sm text-ink-soft">Calling tools…</p> : null}
          {error ? <Banner tone="bad">{error}</Banner> : null}
        </div>
        <form onSubmit={onSubmit} className="border-t border-line p-3">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask the gate"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
          />
          <div className="mt-2 flex justify-end">
            <Button type="submit" disabled={pending || !draft.trim()}>Send</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
