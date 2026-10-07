import { Check, Sparkles, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Ajuda } from "@/components/ajuda";
import { Selecao } from "@/components/selecao";
import { type ChecagemGtin, UNIDADES } from "@/lib/identificacao";
import { cn } from "@/lib/utils";

/**
 * Campos de identificação do produto: SKU, GTIN e unidade.
 *
 * Ficam num arquivo só porque aparecem em dois lugares — o cadastro do produto
 * e o cadastro de variação dentro dele — e divergir entre os dois seria como
 * ter duas regras para o mesmo código.
 */

export function CampoSku({
  id,
  valor,
  erro,
  onChange,
  onSugerir,
}: {
  id: string;
  valor: string;
  erro: string | null;
  onChange: (v: string) => void;
  onSugerir?: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>SKU</Label>
        <Ajuda>
          Código interno da loja, usado para procurar no balcão e conferir estoque. É diferente do
          código de barras, que vem do fabricante.
        </Ajuda>
      </div>
      <div className="flex gap-1.5">
        <Input
          id={id}
          value={valor}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          placeholder="BEB-COCA-001"
          aria-invalid={!!erro}
          className={cn("campo num h-11 flex-1 rounded-sm", erro && "border-destructive")}
        />
        {onSugerir && (
          <button
            type="button"
            onClick={onSugerir}
            title="Sugerir um SKU livre"
            aria-label="Sugerir um SKU livre"
            className="campo grid h-11 w-11 shrink-0 place-items-center rounded-sm text-muted-foreground hover:text-foreground"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      {erro && <p className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}

export function CampoGtin({
  id,
  valor,
  checagem,
  onChange,
  ajuda,
}: {
  id: string;
  valor: string;
  checagem: ChecagemGtin;
  onChange: (v: string) => void;
  ajuda?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>Código de barras (EAN)</Label>
        <Ajuda>
          O número impresso na embalagem pelo fabricante. O sistema confere o dígito verificador na
          hora: um código digitado errado nunca seria encontrado pelo leitor na fila.
        </Ajuda>
      </div>
      <div className="relative">
        <Input
          id={id}
          inputMode="numeric"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Leia com o leitor"
          aria-invalid={checagem.estado === "erro"}
          className={cn(
            "campo num h-11 rounded-sm pr-24",
            checagem.estado === "erro" && "border-destructive",
          )}
        />
        {checagem.estado === "ok" && (
          <span
            className="rotulo absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[10px]"
            style={{ color: "var(--success)" }}
          >
            <Check className="h-3 w-3" aria-hidden /> {checagem.tipo}
          </span>
        )}
      </div>
      {checagem.estado === "erro" ? (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {checagem.mensagem}
        </p>
      ) : (
        ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>
      )}
    </div>
  );
}

export function CampoUnidade({
  id,
  valor,
  onChange,
}: {
  id: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <Selecao
      id={id}
      rotulo="Unidade"
      valor={valor}
      onChange={onChange}
      opcoes={UNIDADES.map((u) => ({ valor: u.valor, rotulo: u.nome }))}
    />
  );
}
