interface Props {
  closes: number[];
}

export default function Sparkline({ closes }: Props) {
  const n = closes.length;
  const lo0 = Math.min(...closes);
  const hi0 = Math.max(...closes);
  const pad = (hi0 - lo0) * 0.04 || 0.5;
  const xAt = (i: number) => (n <= 1 ? 2 : 2 + (i / (n - 1)) * 176);
  const yAt = (v: number) => 26 - ((v - lo0 + pad) / (hi0 - lo0 + 2 * pad)) * 24;
  return (
    <svg className="spark" viewBox="0 0 180 28" role="img" aria-label="7 day pool price">
      <polyline vectorEffect="non-scaling-stroke" className="spark-line" points={closes.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ")} />
      <circle className="spark-dot" cx={xAt(n - 1)} cy={yAt(closes[n - 1])} r={1.5} />
    </svg>
  );
}
