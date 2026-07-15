import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createManualCandidate,
  listCandidates,
} from "../../../lib/candidate-repository";
import {
  ldxpListingSnapshotSchema,
  updateCandidateSnapshot,
  updateCandidateSnapshots,
} from "../../../lib/admin-read-repository";
import {
  assertAdminMutation,
} from "../../../lib/server-auth";
import { databaseFailureCategory } from "../../../lib/database";

const APP_VERSION = "pool-v3";

const createSchema = z.object({
  productUrl: z
    .string()
    .url()
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    }),
});

const priceSnapshotSchema = z.object({
  id: z.string().min(1),
  snapshot: ldxpListingSnapshotSchema,
});

const priceSnapshotBatchSchema = z.object({
  snapshots: z.array(priceSnapshotSchema).min(1).max(100),
});

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  try {
    return NextResponse.json(
      await listCandidates({
        page: Number(searchParams.get("page") ?? 1),
        pageSize: Number(searchParams.get("pageSize") ?? 50),
      }),
      { headers: { "x-app-version": APP_VERSION } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: databaseFailureCategory(error) },
      { status: 503, headers: { "x-app-version": APP_VERSION } },
    );
  }
}

export async function POST(request: Request) {
  const authorization = await assertAdminMutation(request);
  if (!authorization.ok) {
    return NextResponse.json(
      { error: authorization.error },
      { status: authorization.status },
    );
  }
  const body = createSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!body.success) {
    return NextResponse.json(
      { error: "只支持有效的 HTTP/HTTPS 商品 URL" },
      { status: 400 },
    );
  }

  const result = await createManualCandidate(body.data.productUrl);
  return NextResponse.json(
    { ...result.candidate, duplicate: !result.created },
    { status: result.created ? 201 : 200 },
  );
}

export async function PUT(request: Request) {
  const authorization = await assertAdminMutation(request);
  if (!authorization.ok) {
    return NextResponse.json(
      { error: authorization.error },
      { status: authorization.status },
    );
  }
  const payload = await request.json().catch(() => ({}));
  const batch = priceSnapshotBatchSchema.safeParse(payload);
  const single = priceSnapshotSchema.safeParse(payload);
  if (!batch.success && !single.success) {
    return NextResponse.json({ error: "INVALID_PRICE_SNAPSHOT" }, { status: 400 });
  }

  let updated: number;
  if (batch.success) {
    updated = await updateCandidateSnapshots(batch.data.snapshots);
  } else if (single.success) {
    updated = Number(
      await updateCandidateSnapshot(single.data.id, single.data.snapshot),
    );
  } else {
    return NextResponse.json({ error: "INVALID_PRICE_SNAPSHOT" }, { status: 400 });
  }
  return NextResponse.json(
    { updated },
    { status: updated > 0 ? 200 : 404 },
  );
}
