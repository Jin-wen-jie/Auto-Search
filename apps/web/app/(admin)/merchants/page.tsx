import { DataTable, type Column } from "../../../components/data-table";
import { ExternalLink } from "../../../components/external-link";
import { StatusBadge } from "../../../components/status-badge";
import { listMerchantViews } from "../../../lib/admin-read-repository";

type Merchant = Awaited<ReturnType<typeof listMerchantViews>>[number];

const columns: Column<Merchant>[] = [
  { key: "name", header: "商家", render: (row) => <span className="font-semibold text-gray-900">{row.name}</span> },
  { key: "homepage", header: "店铺", render: (row) => row.homepageUrl ? <ExternalLink href={row.homepageUrl}>打开店铺</ExternalLink> : <span className="text-xs text-gray-500">待确认</span> },
  { key: "platform", header: "来源平台", render: (row) => <span className="text-xs text-gray-700">{row.platform}</span> },
  { key: "listings", header: "在售商品", render: (row) => <span className="font-mono font-semibold text-gray-900">{row.activeListings}</span> },
  { key: "verified", header: "最后核验", render: (row) => row.lastVerifiedAt ? <span className="text-xs text-gray-600">{new Date(row.lastVerifiedAt).toLocaleString("zh-CN")}</span> : <span className="text-xs text-gray-500">待验证</span> },
  { key: "status", header: "状态", render: (row) => <StatusBadge status={row.status} /> },
];

export default async function MerchantsPage() {
  const rows = await listMerchantViews();
  return (
    <div>
        <h2 className="mb-1 text-xl font-bold text-gray-900">K12 / Bug Team 商家档案</h2>
      <p className="mb-4 text-xs text-gray-500">仅展示经过候选审核后写入 PostgreSQL 的商家，不把公开线索自动认定为商家档案。</p>
      <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id} />
    </div>
  );
}
