"use client";

import { useRef, useState, useEffect, use } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play } from "lucide-react";

type ProvisionStatus = "idle" | "running" | "SUCCESS" | "FAILED";

export default function ProvisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [status, setStatus] = useState<ProvisionStatus>("idle");
  const [lines, setLines] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines]);

  async function startProvision() {
    setStatus("running");
    setLines([]);

    try {
      const res = await fetch(`/api/vps/${id}/provision`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLines((prev) => [...prev, `ERROR: ${data.error || "Failed to start provisioning"}`]);
        setStatus("FAILED");
        return;
      }

      setLines((prev) => [...prev, "Provisioning started. Connecting to progress stream..."]);

      const es = new EventSource(`/api/vps/${id}/progress`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        const data = event.data;
        if (data === "[DONE]") {
          setStatus("SUCCESS");
          es.close();
          return;
        }
        if (data === "[FAILED]") {
          setStatus("FAILED");
          es.close();
          return;
        }
        setLines((prev) => [...prev, data]);
      };

      es.onerror = () => {
        if (status === "running") {
          setLines((prev) => [...prev, "Connection to progress stream lost."]);
          setStatus("FAILED");
        }
        es.close();
      };
    } catch (err: unknown) {
      setLines((prev) => [...prev, `ERROR: ${err instanceof Error ? err.message : "Unknown error"}`]);
      setStatus("FAILED");
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-zinc-100">Provision VPS</h1>

      <div className="flex items-center gap-4">
        <Button
          onClick={startProvision}
          disabled={status === "running"}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Play className="mr-2 h-4 w-4" />
          {status === "running" ? "Provisioning..." : "Start Provisioning"}
        </Button>

        {status === "SUCCESS" && (
          <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 text-sm px-3 py-1">
            SUCCESS
          </Badge>
        )}
        {status === "FAILED" && (
          <Badge className="bg-red-500/20 text-red-500 border-red-500/30 text-sm px-3 py-1">
            FAILED
          </Badge>
        )}
      </div>

      <Card className="border-zinc-700 bg-zinc-900">
        <CardHeader>
          <CardTitle className="text-zinc-100">Provisioning Log</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={logRef}
            className="max-h-[600px] overflow-auto rounded bg-black p-4 font-mono text-sm text-green-400"
          >
            {lines.length === 0 ? (
              <p className="text-zinc-600">Click &quot;Start Provisioning&quot; to begin...</p>
            ) : (
              lines.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  {line}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
