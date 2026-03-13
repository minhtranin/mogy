import { JsonView, darkStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";

interface ResultJsonProps {
  data: unknown[];
}

export default function ResultJson({ data }: ResultJsonProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
        No results
      </div>
    );
  }

  const displayData = data.length === 1 ? data[0] : data;

  return (
    <div className="h-full overflow-auto p-3">
      <div className="text-xs text-[var(--text-muted)] mb-2">
        {data.length} document{data.length !== 1 ? "s" : ""}
      </div>
      <JsonView
        data={displayData as object}
        style={{
          ...darkStyles,
          container: "json-view",
        }}
        shouldExpandNode={(level) => level < 3}
      />
    </div>
  );
}
