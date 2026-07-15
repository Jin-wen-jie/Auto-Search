import { DataTable, type Column } from "../../../components/data-table";
import { ExternalLink } from "../../../components/external-link";
import { StatusBadge } from "../../../components/status-badge";
import {
  getCollectionIntelligence,
  listAlertViews,
  listSourceViews,
} from "../../../lib/admin-read-repository";
import { ManualUrlForm } from "./manual-url-form";

interface SourceView {
  id: string;
  platform: string;
  status: string;
  cursor: string | null;
  lastRunAt: string | null;
  discovered: number;
  errorCategory: string | null;
  engineSummary: string;
}

const columns: Column<SourceView>[] = [
  {
    key: "platform",
    header: "平台",
    render: (row) => <span className="font-semibold text-gray-900">{row.platform}</span>,
  },
  {
    key: "status",
    header: "状态",
    render: (row) => <StatusBadge status={row.status} />,
  },
  {
    key: "cursor",
    header: "游标",
    render: (row) => (
      <span className="font-mono text-xs text-gray-600">
        {row.cursor ?? "—"}
      </span>
    ),
  },
  {
    key: "lastRun",
    header: "最近运行",
    render: (row) => (
      <span className="text-xs text-gray-600">
        {row.lastRunAt
          ? formatChinaTime(row.lastRunAt)
          : "从未运行"}
      </span>
    ),
  },
  {
    key: "discovered",
    header: "发现数",
    render: (row) => (
      <span className="font-mono font-semibold text-gray-900">
        {row.discovered}
      </span>
    ),
  },
  {
    key: "error",
    header: "说明",
    render: (row) =>
      row.errorCategory ? (
        <span className="font-medium text-orange-700">{row.errorCategory}</span>
      ) : (
        <span className="text-gray-400">—</span>
      ),
  },
  {
    key: "engines",
    header: "采集引擎",
    render: (row) => (
      <span className="max-w-md text-xs leading-5 text-gray-600">
        {row.engineSummary || "—"}
      </span>
    ),
  },
];

type AlertView = Awaited<ReturnType<typeof listAlertViews>>[number];

const alertColumns: Column<AlertView>[] = [
  { key: "kind", header: "类型", render: (row) => <span className={`rounded px-2 py-1 text-xs font-semibold ${row.severity === "warning" ? "bg-amber-100 text-amber-900" : "bg-blue-100 text-blue-800"}`}>{row.kind === "PRICE_DROP" ? "降价" : row.kind === "RESTOCKED" ? "补货" : "价格异常"}</span> },
  { key: "title", header: "提醒", render: (row) => <span className="font-medium text-gray-900">{row.title}</span> },
  { key: "change", header: "变化", render: (row) => <span className="font-mono text-xs text-gray-700">{row.summary}</span> },
  { key: "time", header: "发生时间", render: (row) => <span className="text-xs text-gray-600">{formatChinaTime(row.createdAt)}</span> },
  { key: "product", header: "商品", render: (row) => <ExternalLink href={row.productUrl}>查看</ExternalLink> },
];

export default async function JobsPage() {
  const [sources, intelligence, alerts] = await Promise.all([
    listSourceViews(),
    getCollectionIntelligence(),
    listAlertViews(),
  ]);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">K12 / Bug Team 采集任务</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            多搜索引擎只调查公开的 K12 与 Bug Team 商品网页；新链接去重、验证后进入人工审核。
          </p>
        </div>
        <ManualUrlForm />
      </div>
      <div className="mb-5 grid grid-cols-2 border-y border-gray-200 bg-gray-50 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["历史观察", intelligence.observations],
          ["异常拦截", intelligence.anomalies],
          ["待审核", intelligence.pending],
          ["已通过", intelligence.approved],
          ["已驳回", intelligence.rejected],
          ["未读提醒", intelligence.alerts],
        ].map(([label, value]) => <div key={label} className="border-b border-r border-gray-200 px-3 py-3 last:border-r-0 sm:border-b-0"><div className="text-xs text-gray-500">{label}</div><div className="mt-1 font-mono text-lg font-bold text-gray-900">{value}</div></div>)}
      </div>
      <h3 className="mb-2 text-sm font-semibold text-gray-800">来源连接器</h3>
      <DataTable columns={columns} rows={sources} getRowKey={(row) => row.id} />
      <h3 className="mb-2 mt-6 text-sm font-semibold text-gray-800">价格与库存提醒</h3>
      <DataTable columns={alertColumns} rows={alerts} getRowKey={(row) => row.id} />
      <p className="mt-4 text-xs leading-relaxed text-gray-500">
        Bing RSS 默认启用；Brave、Google 和 Serper 可通过部署密钥扩展覆盖范围。
        搜索每 5 分钟执行一次，单个引擎限流或失败时继续使用其他引擎，不抓取登录墙或验证码页面。
      </p>
    </div>
  );
}

function formatChinaTime(value: string): string {
  const adjusted = new Date(new Date(value).getTime() + 8 * 60 * 60 * 1_000);
  return adjusted.toISOString().replace("T", " ").slice(0, 19);
}
