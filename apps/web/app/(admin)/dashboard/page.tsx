import { DashboardView } from "../../../components/dashboard-view";
import {
  getDashboardCounts,
  listRankingViews,
} from "../../../lib/admin-read-repository";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function DashboardPage() {
  const [rows, counts] = await Promise.all([
    listRankingViews(),
    getDashboardCounts(),
  ]);
  return <DashboardView rows={rows} counts={counts} />;
}
