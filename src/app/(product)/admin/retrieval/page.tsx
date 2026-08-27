import { Search } from "lucide-react";

import { RetrievalLab } from "@/components/admin/retrieval-lab";

export default function RetrievalAdminPage() {
  return <div className="admin-page"><section className="admin-page-heading"><div><p>PRODUCTION RETRIEVAL LAB</p><h2>检索试验</h2><span>用真实平台、内容类型、标签与关键词验证生产 RAG 的命中结果。</span></div><span className="admin-heading-mark"><Search aria-hidden="true" size={20} strokeWidth={1.8} /></span></section><RetrievalLab /></div>;
}
