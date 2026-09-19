import { ImageResponse } from "next/og";

export const alt = "Parsec";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#f7f6f1" }}>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, padding: "72px 80px" }}>
          <div style={{ display: "flex", fontSize: 28, letterSpacing: 8, color: "#15181b" }}>PARSEC</div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flexGrow: 1 }}>
            <div style={{ display: "flex", fontSize: 64, lineHeight: 1.15, color: "#15181b" }}>
              Every on-chain way to own a company, on one label.
            </div>
            <div style={{ display: "flex", fontSize: 30, color: "#6b7078", marginTop: 28 }}>
              Same stock, different prices. Compare them before you sign.
            </div>
          </div>
        </div>
        <div style={{ display: "flex", height: 12, background: "#e8a23a" }} />
      </div>
    ),
    { ...size }
  );
}
