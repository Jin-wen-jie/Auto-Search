import { listCandidates } from "../../../lib/candidate-repository";
import CandidatesClient from "./candidates-client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  try {
    const initialPage = await listCandidates({ page: Number(page ?? 1) });
    return <CandidatesClient initialPage={initialPage} />;
  } catch {
    return (
      <CandidatesClient
        initialPage={{ items: [], page: 1, pageSize: 50, total: 0 }}
        initialError="数据库连接暂时繁忙，请稍后刷新页面。"
      />
    );
  }
}
