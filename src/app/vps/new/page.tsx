"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function NewVpsPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [autoProvision, setAutoProvision] = useState(true);
  const [form, setForm] = useState({
    name: "VPS1",
    ip: "167.86.102.187",
    vncIp: "5.189.128.199",
    vncPort: "63238",
    password: "",
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/vps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          ip: form.ip,
          vncIp: form.vncIp || form.ip,
          vncPort: parseInt(form.vncPort, 10),
          password: form.password,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create VPS");
      }
      const data = await res.json();
      toast.success("VPS created successfully");
      if (autoProvision) {
        // Start provisioning and redirect to log page
        fetch(`/api/vps/${data.id}/provision`, { method: "POST" });
        router.push(`/vps/${data.id}/provision`);
      } else {
        router.push(`/vps/${data.id}`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create VPS");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-zinc-100">Add VPS</h1>

      <Card className="border-zinc-700 bg-zinc-900">
        <CardHeader>
          <CardTitle className="text-zinc-100">VPS Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-zinc-300">Name</Label>
              <Input
                id="name"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="e.g. Production VPS 1"
                required
                className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ip" className="text-zinc-300">IP Address</Label>
              <Input
                id="ip"
                name="ip"
                value={form.ip}
                onChange={handleChange}
                placeholder="e.g. 185.211.5.75"
                required
                className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vncIp" className="text-zinc-300">VNC IP (optional, defaults to IP)</Label>
              <Input
                id="vncIp"
                name="vncIp"
                value={form.vncIp}
                onChange={handleChange}
                placeholder="e.g. 213.136.68.101"
                className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vncPort" className="text-zinc-300">VNC Port</Label>
              <Input
                id="vncPort"
                name="vncPort"
                type="number"
                value={form.vncPort}
                onChange={handleChange}
                placeholder="5900"
                className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-zinc-300">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                value={form.password}
                onChange={handleChange}
                placeholder="VPS / VNC password"
                required
                className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoProvision}
                onChange={(e) => setAutoProvision(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-zinc-300">
                Start provisioning automatically after creation
              </span>
            </label>

            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                disabled={submitting}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {submitting ? "Creating..." : "Create VPS"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.back()}
                className="text-zinc-400 hover:text-zinc-100"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
