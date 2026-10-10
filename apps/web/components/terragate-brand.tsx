import Image from "next/image";

export function TerraGateBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-3">
      <Image
        src="/brand/terragate-mark.svg"
        alt=""
        width={40}
        height={30}
        className={compact ? "h-6 w-8 shrink-0" : "h-[30px] w-10 shrink-0"}
      />
      <span className={compact ? "text-xl font-bold leading-none text-white" : "text-2xl font-bold leading-none text-white"}>
        TerraGate
      </span>
    </span>
  );
}
