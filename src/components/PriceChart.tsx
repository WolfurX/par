"use client";

import type { PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { Candle, HistoryRange } from "@/lib/history";
import { fmtPct, fmtUsd } from "@/lib/units";

interface Props {
  symbol: string;
  candles: Candle[];
  reference: number | null;
  range: HistoryRange;
  onRange: (r: HistoryRange) => void;
}

const MARGIN = { left: 56, right: 8, top: 12, bottom: 22 };
const GRID_FRACTIONS = [0.2, 0.4, 0.6, 0.8];

function fmtTime(t: number): string {
  return new Date(t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function PriceChart({ symbol, candles, reference, range, onRange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 640, h: 220 });
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = candles.length;
  const plotLeft = MARGIN.left;
  const plotRight = size.w - MARGIN.right;
  const plotTop = MARGIN.top;
  const plotBottom = size.h - MARGIN.bottom;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = Math.max(1, plotBottom - plotTop);

  const closes = candles.map((c) => c.c);
  const domainValues = reference != null ? [...closes, reference] : closes;
  const lo0 = Math.min(...domainValues);
  const hi0 = Math.max(...domainValues);
  const span = hi0 - lo0 || 1;
  const lo = lo0 - span * 0.04;
  const hi = hi0 + span * 0.04;

  const xAt = (i: number) => (n <= 1 ? plotLeft : plotLeft + (i / (n - 1)) * plotWidth);
  const yAt = (v: number) => plotBottom - ((v - lo) / (hi - lo)) * plotHeight;

  const last = candles[n - 1];
  const lastX = xAt(n - 1);
  const lastY = yAt(last.c);
  const refY = reference != null ? yAt(reference) : Infinity;

  const xTickIdx = [0, 1, 2, 3].map((i) => Math.round((i / 3) * (n - 1)));

  function onPointerMove(e: PointerEvent<SVGRectElement>) {
    const el = svgRef.current;
    if (!el || n === 0) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left - plotLeft;
    const idx = Math.min(n - 1, Math.max(0, Math.round((x / plotWidth) * (n - 1))));
    setHover(idx);
  }
  function onPointerLeave() {
    setHover(null);
  }

  const hoverCandle = hover != null ? candles[hover] : null;
  const crossX = hover != null ? xAt(hover) : 0;
  const tipW = 150;
  const tipLineH = 16;
  const tipLines = reference != null ? 3 : 2;
  const tipH = 12 + tipLines * tipLineH;
  const tipX = hoverCandle ? (crossX + 10 + tipW > plotRight ? crossX - 10 - tipW : crossX + 10) : 0;
  const tipY = hoverCandle ? Math.max(plotTop, Math.min(plotBottom - tipH, yAt(hoverCandle.c) - tipH / 2)) : 0;

  return (
    <>
      <div className="chart-head">
        <div className="seg" role="group" aria-label="Range">
          <button aria-pressed={range === "7d"} onClick={() => onRange("7d")}>7d</button>
          <button aria-pressed={range === "30d"} onClick={() => onRange("30d")}>30d</button>
        </div>
      </div>
      <svg
        ref={svgRef}
        className="chart-plot"
        viewBox={`0 0 ${size.w} ${size.h}`}
        role="img"
        aria-label={`${symbol} pool price, last ${range === "7d" ? "7 days" : "30 days"}`}
      >
        {GRID_FRACTIONS.map((f) => {
          const v = lo + f * (hi - lo);
          const y = yAt(v);
          return (
            <g key={f}>
              <line className="chart-grid" x1={plotLeft} x2={plotRight} y1={y} y2={y} />
              <text x={50} y={y} textAnchor="end" dominantBaseline="middle">{fmtUsd(v)}</text>
            </g>
          );
        })}
        {xTickIdx.map((idx, i) => (
          <text key={idx} x={xAt(idx)} y={size.h - 6} textAnchor={i === xTickIdx.length - 1 ? "end" : "middle"}>
            {new Date(candles[idx].t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </text>
        ))}
        <polyline className="chart-line" points={candles.map((c, i) => `${xAt(i)},${yAt(c.c)}`).join(" ")} />
        {reference != null ? (
          <>
            <line className="chart-ref" x1={plotLeft} x2={plotRight} y1={refY} y2={refY} />
            <text className="chart-ref-label" x={plotRight} y={refY} textAnchor="end" dy={-6}>{`Reference ${fmtUsd(reference)}`}</text>
          </>
        ) : null}
        <circle className="chart-dot" cx={lastX} cy={lastY} r={4} />
        <text className="chart-last-label" x={plotRight} y={lastY} textAnchor="end" dy={lastY <= refY ? -10 : 16}>{fmtUsd(last.c)}</text>
        <rect
          x={plotLeft}
          y={plotTop}
          width={plotWidth}
          height={plotHeight}
          fill="transparent"
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
        />
        {hoverCandle ? (
          <g>
            <line className="chart-cross" x1={crossX} x2={crossX} y1={plotTop} y2={plotBottom} />
            <g className="chart-tip-g">
              <rect className="chart-tip" x={tipX} y={tipY} width={tipW} height={tipH} />
              <text x={tipX + 8} y={tipY + 16}>{fmtTime(hoverCandle.t)}</text>
              <text x={tipX + 8} y={tipY + 16 + tipLineH}>{`${fmtUsd(hoverCandle.c)} USD`}</text>
              {reference != null ? (
                <text x={tipX + 8} y={tipY + 16 + 2 * tipLineH}>{`${fmtPct(hoverCandle.c / reference - 1)} vs reference`}</text>
              ) : null}
            </g>
          </g>
        ) : null}
      </svg>
      <details className="chart-data">
        <summary>Data</summary>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th className="num">Open</th>
                <th className="num">High</th>
                <th className="num">Low</th>
                <th className="num">Close</th>
              </tr>
            </thead>
            <tbody>
              {candles.map((c) => (
                <tr key={c.t}>
                  <td>{fmtTime(c.t)}</td>
                  <td className="num">{fmtUsd(c.o)}</td>
                  <td className="num">{fmtUsd(c.h)}</td>
                  <td className="num">{fmtUsd(c.l)}</td>
                  <td className="num">{fmtUsd(c.c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
