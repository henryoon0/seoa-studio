export function Section({
  title,
  icon,
  children,
  tone = "neutral",
}: {
  readonly title: string;
  readonly icon: React.ReactNode;
  readonly children: React.ReactNode;
  readonly tone?: "neutral" | "emerald" | "amber" | "sky";
}) {
  const toneClass =
    tone === "emerald"
      ? "bg-[oklch(0.975_0.012_155)]"
      : tone === "amber"
        ? "bg-[oklch(0.978_0.018_85)]"
        : tone === "sky"
          ? "bg-[oklch(0.975_0.012_235)]"
          : "bg-white";
  return (
    <section className={`rounded-xl p-5 shadow-[0px_0px_0px_1px_rgba(0,0,0,0.06),0px_1px_2px_-1px_rgba(0,0,0,0.06),0px_2px_4px_rgba(0,0,0,0.04)] ${toneClass}`}>
      <div className="mb-3 flex items-center gap-1.5">
        {icon}
        <h2 className="text-sm font-bold leading-tight text-neutral-900">{title}</h2>
      </div>
      {children}
    </section>
  );
}
