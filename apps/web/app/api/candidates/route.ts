import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createManualCandidate,
  listCandidates,
} from "../../../lib/candidate-repository";
import {
  assertAdminMutation,
  authorizeAdminRequest,
} from "../../../lib/server-auth";

const createSchema = z.object({
  productUrl: z
    .string()
    .url()
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    }),
});

export async function GET(request: Request) {
  const authorization = await authorizeAdminRequest();
  if (!authorization.ok) {
    return NextResponse.json(
      { error: authorization.error },
      { status: authorization.status },
    );
  }
  const searchParams = new URL(request.url).searchParams;
  return NextResponse.json(
    await listCandidates({
      page: Number(searchParams.get("page") ?? 1),
      pageSize: Number(searchParams.get("pageSize") ?? 50),
    }),
  );
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
