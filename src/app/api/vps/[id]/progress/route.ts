import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const logId = request.nextUrl.searchParams.get("logId");

  const encoder = new TextEncoder();
  let lastLength = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const poll = async () => {
        try {
          const where = logId ? { id: logId } : { vpsId: id };
          const log = await prisma.provisionLog.findFirst({
            where,
            orderBy: { startedAt: "desc" },
          });

          if (!log) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: "No provision log found" })}\n\n`
              )
            );
            controller.close();
            return;
          }

          if (log.logs.length > lastLength) {
            const newText = log.logs.slice(lastLength);
            lastLength = log.logs.length;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ logs: newText })}\n\n`)
            );
          }

          if (log.status !== "RUNNING") {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ status: log.status, finished: true })}\n\n`
              )
            );
            controller.close();
            return;
          }

          setTimeout(poll, 2000);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`)
          );
          controller.close();
        }
      };

      poll();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
