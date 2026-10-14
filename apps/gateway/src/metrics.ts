export class Metrics {
  private readonly calls = new Map<string, number>();

  hit(server: string, tool: string, outcome: "ok" | "error"): void {
    const key = `${server}\t${tool}\t${outcome}`;
    this.calls.set(key, (this.calls.get(key) ?? 0) + 1);
  }

  render(servers: Array<{ slug: string; state: string; latencyMs: number | null }>): string {
    const lines = [
      "# HELP urumi_tool_calls_total Tool calls handled by the gateway",
      "# TYPE urumi_tool_calls_total counter",
    ];
    for (const [key, value] of this.calls) {
      const [server, tool, outcome] = key.split("\t");
      lines.push(`urumi_tool_calls_total{server="${server}",tool="${tool}",outcome="${outcome}"} ${value}`);
    }
    lines.push("# HELP urumi_upstream_up 1 when the latest probe connected");
    lines.push("# TYPE urumi_upstream_up gauge");
    lines.push("# HELP urumi_upstream_latency_ms Latest probe latency");
    lines.push("# TYPE urumi_upstream_latency_ms gauge");
    for (const server of servers) {
      lines.push(`urumi_upstream_up{server="${server.slug}"} ${server.state === "connected" ? 1 : 0}`);
      if (server.latencyMs !== null) {
        lines.push(`urumi_upstream_latency_ms{server="${server.slug}"} ${server.latencyMs}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }
}
