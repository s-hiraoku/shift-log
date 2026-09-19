import { NextRequest, NextResponse } from "next/server";
import { resolveBffApiToken } from "@/lib/bff-auth";

const API_ORIGIN = process.env.SHIFTLOG_API_ORIGIN ?? "http://localhost:8787";
/** Server-only — never expose via NEXT_PUBLIC_*. */

async function proxy(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const resolved = resolveBffApiToken();
  if ("error" in resolved) {
    return NextResponse.json(
      { error: "auth_not_configured", message: resolved.error },
      { status: 503 },
    );
  }

  const { path } = await context.params;
  const target = new URL(`/${path.join("/")}`, API_ORIGIN);
  target.search = req.nextUrl.search;

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("authorization", `Bearer ${resolved.token}`);

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  const upstream = await fetch(target, init);
  const body = await upstream.arrayBuffer();
  const responseHeaders = new Headers();
  const upstreamType = upstream.headers.get("content-type");
  if (upstreamType) responseHeaders.set("content-type", upstreamType);

  return new NextResponse(body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
