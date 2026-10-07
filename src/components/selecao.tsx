import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Os dois seletores do sistema, no lugar do `<select>` nativo.
 *
 * O nativo herda o widget do sistema operacional: no Windows ele aparece claro
 * dentro de uma tela escura, ignora a fonte e os cantos retos do resto, e a
 * lista abre fora da janela do app. Num PDV de balcão isso é mais que feiura —
 * o operador perde meio segundo procurando um controle que parece de outro
 * programa.
 *
 * `Selecao` é para lista curta e fechada. `SelecaoBuscavel` é para lista que
 * cresce, onde digitar é mais rápido que rolar.
 */

/**
 * Sentinela para a opção "nenhum".
 *
 * O Radix recusa `<SelectItem value="">` — ele reserva a string vazia para
 * "nada escolhido" e lança em tempo de render, derrubando a tela inteira. Em
 * vez de proibir a opção vazia em cada chamador, ela é traduzida aqui: quem usa
 * `Selecao` continua passando e recebendo `""`.
 */
const VAZIO = "__vazio__";

export type Opcao = {
  valor: string;
  rotulo: string;
  /** Texto menor à direita: contagem, código, hierarquia. */
  detalhe?: string;
  /** Faixa de cor à esquerda, para categorias. */
  cor?: string;
  /** Recuo, para subcategoria sob a categoria. */
  aninhada?: boolean;
};

export function Selecao({
  id,
  rotulo,
  valor,
  opcoes,
  onChange,
  placeholder = "Selecione",
  ajuda,
  disabled,
  className,
}: {
  id: string;
  rotulo?: string;
  valor: string;
  opcoes: Opcao[];
  onChange: (valor: string) => void;
  placeholder?: string;
  ajuda?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className="space-y-1.5">
      {rotulo && <Label htmlFor={id}>{rotulo}</Label>}
      <Select
        value={valor === "" ? VAZIO : valor}
        onValueChange={(v) => onChange(v === VAZIO ? "" : v)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className={cn("campo h-11 rounded-sm", className)}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent
          position="popper"
          sideOffset={4}
          // Altura e rolagem explícitas: herdada do popper, a lista longa ficava
          // presa dentro do painel lateral e não rolava.
          className="z-[60] max-h-[min(18rem,var(--radix-select-content-available-height))] overflow-y-auto rounded-sm"
        >
          {opcoes.map((o) => (
            <SelectItem
              key={o.valor}
              value={o.valor === "" ? VAZIO : o.valor}
              className="h-11 rounded-sm"
            >
              <span className="flex items-center gap-2">
                {o.cor && <span aria-hidden className="h-3 w-1.5 shrink-0" style={{ background: o.cor }} />}
                {o.rotulo}
                {o.detalhe && (
                  <span className="rotulo text-[10px] text-muted-foreground">{o.detalhe}</span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>}
    </div>
  );
}

const semAcento = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function SelecaoBuscavel({
  id,
  rotulo,
  valor,
  opcoes,
  onChange,
  placeholder = "Selecione",
  placeholderBusca = "Digite para filtrar…",
  vazio = "Nada encontrado.",
  ajuda,
  disabled,
}: {
  id: string;
  rotulo?: string;
  valor: string;
  opcoes: Opcao[];
  onChange: (valor: string) => void;
  placeholder?: string;
  placeholderBusca?: string;
  vazio?: string;
  ajuda?: string;
  disabled?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const selecionada = useMemo(() => opcoes.find((o) => o.valor === valor), [opcoes, valor]);

  return (
    <div className="space-y-1.5">
      {rotulo && <Label htmlFor={id}>{rotulo}</Label>}
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={aberto}
            disabled={disabled}
            className="campo flex h-11 w-full items-center justify-between gap-2 rounded-sm px-3 text-left disabled:opacity-50"
          >
            <span className="flex min-w-0 items-center gap-2">
              {selecionada?.cor && (
                <span aria-hidden className="h-3 w-1.5 shrink-0" style={{ background: selecionada.cor }} />
              )}
              <span className={cn("truncate", !selecionada && "text-muted-foreground")}>
                {selecionada?.rotulo ?? placeholder}
              </span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="z-[60] w-[--radix-popover-trigger-width] rounded-sm p-0"
        >
          <Command
            filter={(value, search) => (semAcento(value).includes(semAcento(search)) ? 1 : 0)}
          >
            <CommandInput placeholder={placeholderBusca} className="h-11" />
            <CommandList>
              <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
                {vazio}
              </CommandEmpty>
              <CommandGroup>
                {opcoes.map((o) => (
                  <CommandItem
                    key={o.valor}
                    // O valor buscável junta rótulo e detalhe: procurar por
                    // "Bebidas" tem que achar a subcategoria "Bebidas › Cerveja".
                    value={`${o.rotulo} ${o.detalhe ?? ""}`}
                    onSelect={() => {
                      onChange(o.valor === valor ? "" : o.valor);
                      setAberto(false);
                    }}
                    className={cn("h-11 gap-2 rounded-sm", o.aninhada && "pl-7")}
                  >
                    <Check
                      className={cn("h-4 w-4 shrink-0", o.valor === valor ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                    {o.cor && <span aria-hidden className="h-3 w-1.5 shrink-0" style={{ background: o.cor }} />}
                    <span className="min-w-0 flex-1 truncate">{o.rotulo}</span>
                    {o.detalhe && (
                      <span className="rotulo shrink-0 text-[10px] text-muted-foreground">
                        {o.detalhe}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>}
    </div>
  );
}
