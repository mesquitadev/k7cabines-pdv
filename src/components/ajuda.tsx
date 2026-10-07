import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Ponto de ajuda.
 *
 * Um "i" discreto ao lado do que precisa de explicação. Existe porque o
 * sistema é usado por gente que troca de turno e nunca recebeu treinamento:
 * a explicação tem que estar ao lado da coisa, não num manual que ninguém abre.
 */
export function Ajuda({
  children,
  className,
  lado = "top",
}: {
  children: ReactNode;
  className?: string;
  lado?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Ajuda"
          className={cn(
            // O alvo tem 44px; o anel visível tem 20px. Um "i" do tamanho do
            // dedo dominaria o título ao lado do qual ele vive.
            "relative inline-grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors after:absolute after:-inset-3 after:content-[''] hover:border-foreground hover:text-foreground",
            className,
          )}
        >
          <Info className="h-3 w-3" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side={lado} className="max-w-xs text-[13px] leading-snug">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
