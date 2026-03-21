import { NextRequest, NextResponse } from "next/server";
import { getSetupJob, getLatestJobForVps } from "@/lib/account-setup";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ vpsId: string }> }
) {
  const { vpsId } = await params;
  const jobId = request.nextUrl.searchParams.get("jobId");

  const job = jobId ? getSetupJob(jobId) : getLatestJobForVps(vpsId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    steps: job.steps,
    error: job.error,
    login: job.login,
    server: job.server,
  });
}
