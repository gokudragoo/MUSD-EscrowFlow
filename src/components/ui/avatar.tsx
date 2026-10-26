export function Avatar({ url, name, size = 44 }: { url: string | null; name: string; size?: number }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full border border-ink-600 object-cover" style={{ width: size, height: size }} />;
  }
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="grid shrink-0 place-items-center rounded-full border border-ink-600 bg-ink-700 text-[14px] font-semibold text-mist-100" style={{ width: size, height: size }} aria-hidden>
      {initials || "?"}
    </span>
  );
}
