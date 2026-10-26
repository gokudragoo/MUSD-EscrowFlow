import { ImageResponse } from "next/og";

export const alt = "MUSD EscrowFlow — milestone escrow paid in MUSD on Mezo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  const segs = [
    { w: 40, c: "#2fc6f6" },
    { w: 60, c: "#8b83ff" },
    { w: 60, c: "#8b83ff" },
    { w: 40, c: "#8b83ff" },
  ];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0a1022", padding: 72, color: "#e6ecf7", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "#111b37", border: "2px solid #34477a", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, background: "#2fc6f6" }} />
          </div>
          EscrowFlow · MUSD on Mezo
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 76, fontWeight: 700, color: "#ffffff", lineHeight: 1.05 }}>Work with confidence. Pay with trust.</div>
          <div style={{ fontSize: 30, color: "#aebbd6" }}>Milestone escrow for freelance work — every deposit and payment verifiable on-chain.</div>
        </div>
        <div style={{ display: "flex", gap: 8, height: 22 }}>
          {segs.map((s, i) => (
            <div key={i} style={{ flexGrow: s.w, background: s.c, borderRadius: 11 }} />
          ))}
        </div>
      </div>
    ),
    size,
  );
}
