"use client";

import { useRef, useState, useEffect, use, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  Play,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
} from "lucide-react";

type ProvisionStatus = "idle" | "running" | "SUCCESS" | "FAILED";

const STEPS = [
  { key: "ssh_check", label: "Checking SSH access", match: "Checking if SSH" },
  { key: "vnc_connect", label: "Connecting to VNC", match: "Connecting to VNC" },
  { key: "vnc_login", label: "Logging into Windows", match: "Step 1: Lock" },
  { key: "vnc_password", label: "Setting up password", match: "Step 2: Password" },
  { key: "vnc_desktop", label: "Loading desktop", match: "Waiting 60s for desktop" },
  { key: "vnc_powershell", label: "Opening PowerShell", match: "Opening PowerShell" },
  { key: "vnc_openssh", label: "Installing OpenSSH", match: "Installing OpenSSH" },
  { key: "vnc_sshd", label: "Starting SSH service", match: "Starting sshd" },
  { key: "ssh_verify", label: "Verifying SSH connection", match: "SSH is up" },
  { key: "ssh_connect", label: "Connecting via SSH", match: "Connecting SSH to" },
  { key: "python_install", label: "Installing Python", match: "[1/6] Installing Python" },
  { key: "python_deps", label: "Installing dependencies", match: "[2/6] Installing Python" },
  { key: "create_dirs", label: "Creating directories", match: "[3/6] Creating directories" },
  { key: "copy_files", label: "Copying project files", match: "[4/6] Copying project" },
  { key: "firewall", label: "Configuring firewall & task", match: "[5/6] Configuring firewall" },
  { key: "start_api", label: "Starting API server", match: "[6/6] Starting API" },
  { key: "verify_api", label: "Verifying API", match: "API is running" },
  { key: "done", label: "Setup complete", match: "SETUP COMPLETE" },
];

function getProgress(logs: string): {
  currentStep: number;
  percent: number;
  currentLabel: string;
} {
  let currentStep = 0;

  for (let i = 0; i < STEPS.length; i++) {
    if (logs.includes(STEPS[i].match)) {
      currentStep = i + 1;
    }
  }

  const percent = Math.round((currentStep / STEPS.length) * 100);
  const currentLabel =
    currentStep >= STEPS.length
      ? "Complete!"
      : STEPS[currentStep]?.label ?? "Starting...";

  return { currentStep, percent, currentLabel };
}

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
  const [showLog, setShowLog] = useState(false);

  const progress = useMemo(() => getProgress(logs), [logs]);

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
        // No existing provision
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

      {/* Progress Card */}
      <Card className="border-zinc-700 bg-zinc-900">
        <CardContent className="pt-6">
          {/* Top row: button, status badge, percentage */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <Button
                onClick={startProvision}
                disabled={status === "running"}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Play className="mr-2 h-4 w-4" />
                {status === "running"
                  ? "Provisioning..."
                  : "Start Provisioning"}
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

            {status !== "idle" && (
              <span className="text-2xl font-bold text-zinc-100">
                {status === "SUCCESS"
                  ? "100%"
                  : status === "FAILED"
                    ? `${progress.percent}%`
                    : `${progress.percent}%`}
              </span>
            )}
          </div>

          {/* Progress bar */}
          {status !== "idle" && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-zinc-400">
                  {status === "running" && (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {progress.currentLabel}
                    </span>
                  )}
                  {status === "SUCCESS" && "VPS is ready to use!"}
                  {status === "FAILED" && "Provisioning failed — check logs below"}
                </span>
                <span className="text-xs text-zinc-500">
                  Step {Math.min(progress.currentStep, STEPS.length)} of{" "}
                  {STEPS.length}
                </span>
              </div>
              <div className="h-3 w-full rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${
                    status === "FAILED"
                      ? "bg-red-500"
                      : status === "SUCCESS"
                        ? "bg-emerald-500"
                        : "bg-blue-500"
                  }`}
                  style={{
                    width: `${status === "SUCCESS" ? 100 : progress.percent}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Steps checklist */}
          {status !== "idle" && (
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
              {STEPS.map((step, i) => {
                const completed = progress.currentStep > i;
                const active =
                  status === "running" && progress.currentStep === i;
                const failed =
                  status === "FAILED" && progress.currentStep === i;

                return (
                  <div key={step.key} className="flex items-center gap-2">
                    {completed ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : failed ? (
                      <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                    ) : active ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-zinc-700" />
                    )}
                    <span
                      className={`text-sm ${
                        completed
                          ? "text-zinc-300"
                          : active
                            ? "text-blue-400 font-medium"
                            : failed
                              ? "text-red-400"
                              : "text-zinc-600"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Log toggle + terminal */}
      {status !== "idle" && (
        <Card className="border-zinc-700 bg-zinc-900">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-zinc-100">Detailed Log</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowLog(!showLog)}
                className="text-zinc-400 hover:text-zinc-100"
              >
                {showLog ? "Hide" : "Show"}
              </Button>
            </div>
          </CardHeader>
          {showLog && (
            <CardContent>
              <pre
                ref={logRef}
                className="max-h-[400px] min-h-[100px] overflow-auto rounded bg-black p-4 font-mono text-xs leading-5 text-green-400"
              >
                {logs || (
                  <span className="text-zinc-600">Waiting for output...</span>
                )}
              </pre>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
