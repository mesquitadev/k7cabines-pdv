import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Botão de ação só com ícone.
 *
 * Ícone sozinho é adivinhação: o nome da função aparece ao passar o mouse e,
 * para quem usa leitor de tela ou teclado, vai no `aria-label` — que é o mesmo
 * texto, para não haver duas verdades.
 */
export function BotaoAcao({
  rotulo,
  onClick,
  children,
  disabled,
  destrutivo,
  className,
}: {
  rotulo: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  destrutivo?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          onClick={onClick}
          disabled={disabled}
          aria-label={rotulo}
          className={cn(
            "h-11 w-11 rounded-sm",
            destrutivo && "hover:text-destructive",
            className,
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="rotulo text-[11px]">
        {rotulo}
      </TooltipContent>
    </Tooltip>
  );
}
