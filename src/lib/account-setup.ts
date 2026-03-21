import { prisma } from "./prisma";
import { VpsClient } from "./vps-client";
import { notifyTelegram } from "./notify";
import type { AddAccountRequest } from "./types";

// In-memory job tracker (fine for single instance on Railway)
interface SetupJob {
  id: string;
  vpsId: string;
  login: string;
  server: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  steps: string[];
  error?: string;
}

const jobs = new Map<string, SetupJob>();

export function getSetupJob(jobId: string): SetupJob | undefined {
  return jobs.get(jobId);
}

export function getLatestJobForVps(vpsId: string): SetupJob | undefined {
  let latest: SetupJob | undefined;
  for (const job of jobs.values()) {
    if (job.vpsId === vpsId) {
      latest = job;
    }
  }
  return latest;
}

export async function startAccountSetup(
  vpsId: string,
  ip: string,
  apiPort: number,
  req: AddAccountRequest & { broker?: string }
): Promise<string> {
  const jobId = `setup_${Date.now()}_${req.login}`;
  const job: SetupJob = {
    id: jobId,
    vpsId,
    login: req.login,
    server: req.server,
    status: "PENDING",
    steps: ["Starting account setup..."],
  };
  jobs.set(jobId, job);

  // Create account in DB immediately as SETUP so it's visible in the UI
  await prisma.account.upsert({
    where: {
      vpsId_server_login: { vpsId, server: req.server, login: req.login },
    },
    create: {
      vpsId,
      login: req.login,
      server: req.server,
      broker: req.broker ?? null,
      status: "SETUP",
    },
    update: {
      status: "SETUP",
      broker: req.broker ?? undefined,
    },
  });

  // Run in background
  runSetup(job, ip, apiPort, req).catch((err) => {
    job.status = "FAILED";
    job.error = err instanceof Error ? err.message : String(err);
    job.steps.push(`ERROR: ${job.error}`);
  });

  return jobId;
}

async function runSetup(
  job: SetupJob,
  ip: string,
  apiPort: number,
  req: AddAccountRequest & { broker?: string }
) {
  const client = new VpsClient({ ip, apiPort });

  job.steps.push("Sending setup request to VPS...");
  job.steps.push(
    "This will download the MT5 installer, install in portable mode,"
  );
  job.steps.push(
    "configure credentials, compile PythonBridge EA, and start the terminal."
  );
  job.steps.push("This typically takes 2-4 minutes.");
  job.steps.push("");

  try {
    const result = (await client.addAccount(req)) as {
      status: string;
      message: string;
      connected: boolean;
      steps: string[];
      account_info?: Record<string, string>;
    };

    // Relay VPS steps
    if (result.steps) {
      for (const step of result.steps) {
        job.steps.push(`  ${step}`);
      }
    }

    job.steps.push("");

    const balance = parseFloat(result.account_info?.balance || "0");
    const equity = parseFloat(result.account_info?.equity || "0");
    const isActive = result.connected && balance > 0;

    // Update account in DB — mark ACTIVE if connected with balance, keep SETUP otherwise
    await prisma.account.update({
      where: {
        vpsId_server_login: {
          vpsId: job.vpsId,
          server: req.server,
          login: req.login,
        },
      },
      data: {
        broker: req.broker ?? undefined,
        connected: result.connected,
        balance,
        equity,
        status: isActive ? "ACTIVE" : "SETUP",
      },
    });

    if (result.connected) {
      job.steps.push(
        `Account ${req.login} connected to ${req.server}!`
      );
      job.steps.push(
        `Balance: ${result.account_info?.balance ?? "?"}`
      );
    } else {
      job.steps.push(
        `Account ${req.login} set up but not yet connected to broker.`
      );
      job.steps.push("The terminal may need a moment to connect, or the market may be closed.");
    }

    job.status = "SUCCESS";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.steps.push(`Failed: ${message}`);
    job.status = "FAILED";
    job.error = message;
    notifyTelegram(`🚨 <b>Account Setup Failed</b>\n<code>${req.login}@${req.server}</code>\n${message}`);

    // Mark account as FAILED in DB
    try {
      await prisma.account.update({
        where: {
          vpsId_server_login: {
            vpsId: job.vpsId,
            server: req.server,
            login: req.login,
          },
        },
        data: { status: "FAILED" },
      });
    } catch {
      // ignore — account may not exist if DB create failed earlier
    }
  }
}
