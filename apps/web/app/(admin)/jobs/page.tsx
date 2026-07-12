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
            来源连接器搜索关键词仅覆盖 K12 教育资格和 Bug Team 相关商品。缺少凭据时显示为未配置，不影响手工补链。
          </p>
        </div>
        <ManualUrlForm />
      </div>
      <h3 className="mb-2 text-sm font-semibold text-gray-800">来源连接器</h3>
      <DataTable columns={columns} rows={sources} getRowKey={(row) => row.id} />
      <p className="mt-4 text-xs leading-relaxed text-gray-500">
        X 和 Telegram 连接器需要分别在部署环境中提供有效的 Bearer Token 或
        api_id/api_hash/session。缺少凭据时连接器显示为"未配置"，不伪造零结果。
        调度频率：来源发现每 30 分钟，链接复检每 6 小时，汇率每日刷新。
      </p>
    </div>
  );
}
