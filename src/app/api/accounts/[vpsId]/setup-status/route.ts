import { NextRequest, NextResponse } from "next/server";
import { getSetupJob } from "@/lib/account-setup";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }

  const job = getSetupJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: job.status,
    steps: job.steps,
    error: job.error,
    login: job.login,
    server: job.server,
  });
}
