import { ImageResponse } from "next/og";

export const alt = "MUSD EscrowFlow: milestone escrow paid in MUSD on Mezo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  // Same money vocabulary as the app: brass = paid, light slate = held.
  const segs = [
    { w: 40, c: "#d4a548" },
    { w: 60, c: "#aab4c4" },
    { w: 60, c: "#aab4c4" },
    { w: 40, c: "#aab4c4" },
  ];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0e1420", padding: 72, color: "#e3e7ee", fontFamily: "serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, fontFamily: "sans-serif" }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: "#17202f", border: "2px solid #314058", display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
            <div style={{ width: 11, height: 6, borderRadius: 2, background: "#d4a548" }} />
            <div style={{ width: 7, height: 6, borderRadius: 2, background: "#aab4c4" }} />
          </div>
          EscrowFlow, MUSD on Mezo
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 78, fontWeight: 600, color: "#ffffff", lineHeight: 1.05 }}>Work with confidence. Pay with trust.</div>
          <div style={{ fontSize: 30, color: "#b3bccb", fontFamily: "sans-serif" }}>Milestone escrow for freelance work. Every deposit and payment verifiable on-chain.</div>
        </div>
        <div style={{ display: "flex", gap: 8, height: 22 }}>
          {segs.map((s, i) => (
            <div key={i} style={{ flexGrow: s.w, background: s.c, borderRadius: 6 }} />
          ))}
        </div>
      </div>
    ),
    size,
  );
}
