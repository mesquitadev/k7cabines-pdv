import { forwardRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Campo de dinheiro com entrada por centavos.
 *
 * Quem opera balcão digita o valor da direita para a esquerda, como na
 * maquininha e na calculadora: `800` é oito reais, `8` é oito centavos. Um
 * campo numérico comum lê `800` como oitocentos reais — o erro só aparece no
 * cupom, e aí a fila já andou.
 *
 * O valor guardado é sempre inteiro em centavos, que é como o banco guarda.
 * Nada de float no caminho.
 */

export const centavosParaTexto = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const CampoMoeda = forwardRef<
  HTMLInputElement,
  {
    id: string;
    rotulo?: string;
    centavos: number;
    onChange: (centavos: number) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    autoFocus?: boolean;
    disabled?: boolean;
    className?: string;
    ajuda?: string;
    /** Destaque para o campo principal de recebimento. */
    grande?: boolean;
  }
>(function CampoMoeda(
  { id, rotulo, centavos, onChange, onKeyDown, autoFocus, disabled, className, ajuda, grande },
  ref,
) {
  const digitar = (bruto: string) => {
    // Só os dígitos importam: o resto é máscara que o próprio campo redesenha.
    const digitos = bruto.replace(/\D/g, "").slice(0, 9);
    onChange(digitos ? parseInt(digitos, 10) : 0);
  };

  return (
    <div className="space-y-1.5">
      {rotulo && <Label htmlFor={id}>{rotulo}</Label>}
      <div className="relative">
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground",
            grande ? "text-lg" : "text-sm",
          )}
        >
          R$
        </span>
        <Input
          id={id}
          ref={ref}
          inputMode="numeric"
          autoFocus={autoFocus}
          disabled={disabled}
          value={centavosParaTexto(centavos)}
          onChange={(e) => digitar(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={(e) => e.currentTarget.select()}
          className={cn(
            "campo num rounded-sm pl-10 text-right tabular-nums",
            grande ? "h-16 text-3xl" : "h-11",
            className,
          )}
        />
      </div>
      {ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>}
    </div>
  );
});
