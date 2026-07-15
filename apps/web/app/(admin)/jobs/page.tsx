import { DataTable, type Column } from "../../../components/data-table";
import { StatusBadge } from "../../../components/status-badge";
import { listSourceViews } from "../../../lib/admin-read-repository";
import { ManualUrlForm } from "./manual-url-form";

interface SourceView {
  id: string;
  platform: string;
  status: string;
  cursor: string | null;
  lastRunAt: string | null;
  discovered: number;
  errorCategory: string | null;
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
          ? new Date(row.lastRunAt).toLocaleString("zh-CN")
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
];

export default async function JobsPage() {
  const sources = await listSourceViews();

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
      <h3 className="mb-2 text-sm font-semibold text-gray-800">来源连接器</h3>
      <DataTable columns={columns} rows={sources} getRowKey={(row) => row.id} />
      <p className="mt-4 text-xs leading-relaxed text-gray-500">
        Bing RSS 默认启用；Brave、Google 和 Serper 可通过部署密钥扩展覆盖范围。
        搜索每 3 小时执行一次，单个引擎限流或失败时继续使用其他引擎，不抓取登录墙或验证码页面。
      </p>
    </div>
  );
}
