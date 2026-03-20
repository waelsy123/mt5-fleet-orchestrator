"use client";

import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";

const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

export default function DocsPage() {
  return (
    <div className="swagger-wrapper">
      <SwaggerUI url="/api/docs" />
      <style>{`
        .swagger-wrapper {
          background: #1a1a2e;
          min-height: 100vh;
        }
        /* Dark theme overrides for Swagger UI */
        .swagger-ui { color: #e0e0e0; }
        .swagger-ui .topbar { display: none; }
        .swagger-ui .info .title { color: #f0f0f0; }
        .swagger-ui .info .description p { color: #c0c0c0; }
        .swagger-ui .info a { color: #60a5fa; }
        .swagger-ui .scheme-container { background: #16213e; box-shadow: none; }
        .swagger-ui .opblock-tag { color: #e0e0e0 !important; border-bottom-color: #333 !important; }
        .swagger-ui .opblock-tag:hover { background: rgba(255,255,255,0.03); }
        .swagger-ui .opblock { border-color: #333; background: #16213e; }
        .swagger-ui .opblock .opblock-summary { border-color: #333; }
        .swagger-ui .opblock .opblock-summary-method { font-weight: 700; }
        .swagger-ui .opblock .opblock-summary-path { color: #e0e0e0 !important; }
        .swagger-ui .opblock .opblock-summary-description { color: #a0a0a0; }
        .swagger-ui .opblock.opblock-get { background: rgba(96, 165, 250, 0.05); border-color: rgba(96, 165, 250, 0.3); }
        .swagger-ui .opblock.opblock-get .opblock-summary { border-color: rgba(96, 165, 250, 0.2); }
        .swagger-ui .opblock.opblock-post { background: rgba(74, 222, 128, 0.05); border-color: rgba(74, 222, 128, 0.3); }
        .swagger-ui .opblock.opblock-post .opblock-summary { border-color: rgba(74, 222, 128, 0.2); }
        .swagger-ui .opblock.opblock-delete { background: rgba(248, 113, 113, 0.05); border-color: rgba(248, 113, 113, 0.3); }
        .swagger-ui .opblock.opblock-delete .opblock-summary { border-color: rgba(248, 113, 113, 0.2); }
        .swagger-ui .opblock.opblock-patch { background: rgba(251, 191, 36, 0.05); border-color: rgba(251, 191, 36, 0.3); }
        .swagger-ui .opblock.opblock-patch .opblock-summary { border-color: rgba(251, 191, 36, 0.2); }
        .swagger-ui .opblock-body { background: #0f172a; }
        .swagger-ui .opblock-body pre { background: #0a0a1a !important; color: #e0e0e0 !important; }
        .swagger-ui table thead tr th { color: #a0a0a0; border-bottom-color: #333; }
        .swagger-ui table tbody tr td { color: #c0c0c0; border-bottom-color: #222; }
        .swagger-ui .parameter__name { color: #e0e0e0; }
        .swagger-ui .parameter__type { color: #60a5fa; }
        .swagger-ui .parameter__in { color: #888; }
        .swagger-ui .model-title { color: #e0e0e0; }
        .swagger-ui .model { color: #c0c0c0; }
        .swagger-ui .model-box { background: #16213e; }
        .swagger-ui .model .property { color: #e0e0e0; }
        .swagger-ui .model .property.primitive { color: #60a5fa; }
        .swagger-ui section.models { border-color: #333; }
        .swagger-ui section.models h4 { color: #e0e0e0; border-bottom-color: #333; }
        .swagger-ui .model-container { background: #16213e; border-color: #333; }
        .swagger-ui .responses-inner { padding: 12px; }
        .swagger-ui .response-col_status { color: #e0e0e0; }
        .swagger-ui .response-col_description { color: #c0c0c0; }
        .swagger-ui .response-col_links { color: #888; }
        .swagger-ui .btn { color: #e0e0e0; border-color: #555; }
        .swagger-ui .btn:hover { background: rgba(255,255,255,0.05); }
        .swagger-ui select { background: #16213e; color: #e0e0e0; border-color: #444; }
        .swagger-ui input[type=text] { background: #16213e; color: #e0e0e0; border-color: #444; }
        .swagger-ui textarea { background: #16213e; color: #e0e0e0; border-color: #444; }
        .swagger-ui .prop-type { color: #60a5fa; }
        .swagger-ui .prop-format { color: #888; }
        .swagger-ui .markdown p, .swagger-ui .markdown li { color: #c0c0c0; }
        .swagger-ui .renderedMarkdown p { color: #c0c0c0; }
        .swagger-ui .servers > label { color: #c0c0c0; }
        .swagger-ui .servers > label select { background: #16213e; color: #e0e0e0; }
        .swagger-ui .copy-to-clipboard { bottom: 5px; right: 5px; }
        .swagger-ui .microlight { background: #0a0a1a !important; color: #e0e0e0 !important; }
        .swagger-ui .json-schema-2020-12 .json-schema-2020-12-keyword { color: #c0c0c0; }
        .swagger-ui .json-schema-2020-12 .json-schema-2020-12-keyword__name { color: #60a5fa; }
        .swagger-ui .json-schema-2020-12 .json-schema-2020-12-keyword__value { color: #4ade80; }
        .swagger-ui .loading-container .loading { color: #888; }
        .swagger-ui .loading-container .loading::after { border-color: #444 #444 #444 #60a5fa; }
      `}</style>
    </div>
  );
}
