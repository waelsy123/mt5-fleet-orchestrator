"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface AccountOption {
  vpsId: string;
  vpsName: string;
  login: string;
  server: string;
}

export default function TradePage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [symbol, setSymbol] = useState("EURUSD");
  const [volume, setVolume] = useState("0.01");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function fetchAccounts() {
      try {
        const res = await fetch("/api/accounts");
        if (!res.ok) throw new Error("Failed to fetch accounts");
        const json = await res.json();
        setAccounts(json);
      } catch {
        toast.error("Failed to load accounts");
      } finally {
        setLoading(false);
      }
    }
    fetchAccounts();
  }, []);

  function getSelected(): AccountOption | undefined {
    return accounts.find(
      (a) => `${a.vpsId}|${a.server}|${a.login}` === selectedAccount
    );
  }

  async function executeTrade(direction: "buy" | "sell") {
    const account = getSelected();
    if (!account) {
      toast.error("Please select an account");
      return;
    }
    if (!symbol.trim()) {
      toast.error("Please enter a symbol");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/accounts/${account.vpsId}/${encodeURIComponent(account.server)}/${account.login}/${direction}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: symbol.trim().toUpperCase(),
            volume: parseFloat(volume),
            sl: sl ? parseFloat(sl) : undefined,
            tp: tp ? parseFloat(tp) : undefined,
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to execute ${direction.toUpperCase()}`);
      }
      const data = await res.json();
      toast.success(
        `${direction.toUpperCase()} ${volume} ${symbol.toUpperCase()} executed successfully${data.ticket ? ` (ticket: ${data.ticket})` : ""}`
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Trade execution failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-zinc-100">Trade</h1>

      <Card className="border-zinc-700 bg-zinc-900">
        <CardHeader>
          <CardTitle className="text-zinc-100">New Order</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-zinc-300">Account</Label>
            {loading ? (
              <p className="text-sm text-zinc-500">Loading accounts...</p>
            ) : (
              <Select value={selectedAccount} onValueChange={(v) => setSelectedAccount(v ?? "")}>
                <SelectTrigger className="border-zinc-700 bg-zinc-800 text-zinc-100">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent className="border-zinc-700 bg-zinc-800">
                  {accounts.map((a) => (
                    <SelectItem
                      key={`${a.vpsId}|${a.server}|${a.login}`}
                      value={`${a.vpsId}|${a.server}|${a.login}`}
                      className="text-zinc-100 focus:bg-zinc-700 focus:text-zinc-100"
                    >
                      {a.login} @ {a.server} ({a.vpsName})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-zinc-300">Symbol</Label>
            <Input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. EURUSD"
              className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-zinc-300">Volume (lots)</Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
              className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-zinc-300">Stop Loss (optional)</Label>
              <Input
                type="number"
                step="0.00001"
                value={sl}
                onChange={(e) => setSl(e.target.value)}
                placeholder="Price"
                className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-300">Take Profit (optional)</Label>
              <Input
                type="number"
                step="0.00001"
                value={tp}
                onChange={(e) => setTp(e.target.value)}
                placeholder="Price"
                className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              onClick={() => executeTrade("buy")}
              disabled={submitting || !selectedAccount}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              {submitting ? "Executing..." : "BUY"}
            </Button>
            <Button
              onClick={() => executeTrade("sell")}
              disabled={submitting || !selectedAccount}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold"
            >
              {submitting ? "Executing..." : "SELL"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
