import { listCandidates } from "../../../lib/candidate-repository";
import CandidatesClient from "./candidates-client";

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const initialPage = await listCandidates({ page: Number(page ?? 1) });
  return <CandidatesClient initialPage={initialPage} />;
}
