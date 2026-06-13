import Image from "next/image";
import { cn } from "@/lib/utils";

interface PocuLogoProps {
  size?: number;
  className?: string;
  priority?: boolean;
}

export function PocuLogo({ size = 36, className, priority }: PocuLogoProps) {
  return (
    <Image
      src="/logo/image.png"
      alt="POCU"
      width={size}
      height={size}
      priority={priority}
      className={cn("rounded-lg object-contain", className)}
    />
  );
}
