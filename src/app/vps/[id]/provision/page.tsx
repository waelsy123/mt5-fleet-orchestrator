"use client";

import { useRef, useState, useEffect, use } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Play, ArrowLeft } from "lucide-react";

type ProvisionStatus = "idle" | "running" | "SUCCESS" | "FAILED";

export default function ProvisionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [status, setStatus] = useState<ProvisionStatus>("idle");
  const [logs, setLogs] = useState("");
  const logRef = useRef<HTMLPreElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  // Check if there's already a running provision
  useEffect(() => {
    async function checkExisting() {
      try {
        const res = await fetch(`/api/vps/${id}/progress/status`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === "RUNNING") {
            setStatus("running");
            setLogs(data.logs || "");
            connectSSE();
          } else if (data.status === "SUCCESS" || data.status === "FAILED") {
            setStatus(data.status);
            setLogs(data.logs || "");
          }
        }
      } catch {
        // No existing provision — that's fine
      }
    }
    checkExisting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function connectSSE() {
    const es = new EventSource(`/api/vps/${id}/progress`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.logs) {
          setLogs((prev) => prev + data.logs);
        }

        if (data.finished) {
          setStatus(data.status === "SUCCESS" ? "SUCCESS" : "FAILED");
          es.close();
        }

        if (data.error) {
          setLogs((prev) => prev + `\nERROR: ${data.error}\n`);
          setStatus("FAILED");
          es.close();
        }
      } catch {
        // Plain text fallback
        setLogs((prev) => prev + event.data + "\n");
      }
    };

    es.onerror = () => {
      setLogs((prev) => prev + "\nConnection to progress stream lost.\n");
      setStatus("FAILED");
      es.close();
    };
  }

  async function startProvision() {
    setStatus("running");
    setLogs("");

    try {
      const res = await fetch(`/api/vps/${id}/provision`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLogs(`ERROR: ${data.error || "Failed to start provisioning"}\n`);
        setStatus("FAILED");
        return;
      }

      setLogs("Provisioning started...\n");
      connectSSE();
    } catch (err: unknown) {
      setLogs(
        `ERROR: ${err instanceof Error ? err.message : "Unknown error"}\n`
      );
      setStatus("FAILED");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/vps/${id}`}>
          <Button variant="ghost" size="sm" className="text-zinc-400">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
        </Link>
        <h1 className="text-2xl font-bold text-zinc-100">Provision VPS</h1>
      </div>

      <div className="flex items-center gap-4">
        <Button
          onClick={startProvision}
          disabled={status === "running"}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Play className="mr-2 h-4 w-4" />
          {status === "running" ? "Provisioning..." : "Start Provisioning"}
        </Button>

        {status === "running" && (
          <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30 text-sm px-3 py-1 animate-pulse">
            RUNNING
          </Badge>
        )}
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
          <pre
            ref={logRef}
            className="max-h-[600px] min-h-[200px] overflow-auto rounded bg-black p-4 font-mono text-xs leading-5 text-green-400"
          >
            {logs || (
              <span className="text-zinc-600">
                {status === "running"
                  ? "Waiting for output..."
                  : 'Click "Start Provisioning" to begin...'}
              </span>
            )}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
