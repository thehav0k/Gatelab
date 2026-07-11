"use client";

import {
  canonicalPos,
  canonicalSop,
  dontCares,
  maxterms,
  minterms,
} from "@/lib/core-engine/canonical";
import { format } from "@/lib/core-engine/format";
import { literalCount } from "@/lib/core-engine/ast";
import type { BooleanFunction } from "@/lib/core-engine/types";

interface Props {
  fn: BooleanFunction;
}

export function FunctionSummary({ fn }: Props) {
  const ms = minterms(fn);
  const Ms = maxterms(fn);
  const ds = dontCares(fn);
  const sop = canonicalSop(fn);
  const pos = canonicalPos(fn);

  const vars = fn.variables.join(", ");

  return (
    <dl className="space-y-4 text-sm">
      <Row label="Minterms">
        <span className="font-mono">
          Σm({ms.join(", ")})
          {ds.length > 0 && (
            <span className="text-logic-z"> + d({ds.join(", ")})</span>
          )}
        </span>
      </Row>

      <Row label="Maxterms">
        <span className="font-mono">ΠM({Ms.join(", ")})</span>
      </Row>

      <Row label="Canonical SOP">
        <code className="text-xs leading-relaxed break-words">
          {format(sop)}
        </code>
        <Cost n={literalCount(sop)} />
      </Row>

      <Row label="Canonical POS">
        <code className="text-xs leading-relaxed break-words">
          {format(pos)}
        </code>
        <Cost n={literalCount(pos)} />
      </Row>

      <Row label="Variables">
        <span className="font-mono">
          {vars}{" "}
          <span className="text-muted-foreground">
            ({fn.variables.length} → {fn.values.length} rows)
          </span>
        </span>
      </Row>
    </dl>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function Cost({ n }: { n: number }) {
  return (
    <span className="text-muted-foreground ml-2 text-xs whitespace-nowrap">
      {n} literal{n === 1 ? "" : "s"}
    </span>
  );
}
